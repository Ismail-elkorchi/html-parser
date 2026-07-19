import { createParseError, type EngineParseError, type HtmlParseErrorCode } from "./diagnostics.js";
import { sourcePosition, sourceSpan, type SourcePosition, type SourceSpan } from "./positions.js";
import { EngineConfigurationError, type EngineResourceGuard } from "./resource-guard.js";

/** One normalized input character and its original decoded-source span. */
export interface InputCharacter {
  readonly kind: "character";
  readonly value: string;
  readonly span: SourceSpan;
}

/** More decoded input is required to distinguish a chunk-boundary sequence. */
export interface InputNeedMore {
  readonly kind: "need-more-input";
  readonly position: SourcePosition;
}

/** Conceptual end of the closed decoded-input stream. */
export interface InputEof {
  readonly kind: "eof";
  readonly position: SourcePosition;
}

/** Result of one cursor consume step. */
export type InputRead = InputCharacter | InputNeedMore | InputEof;

export type InputParseErrorObserver = (error: EngineParseError) => void;

function isLeadingSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isTrailingSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function isSurrogate(codePoint: number): boolean {
  return codePoint >= 0xd800 && codePoint <= 0xdfff;
}

function isNoncharacter(codePoint: number): boolean {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
    (codePoint >= 0xfffe && codePoint <= 0x10ffff && (codePoint & 0xffff) >= 0xfffe);
}

function isDisallowedControl(codePoint: number): boolean {
  const control = (codePoint >= 0 && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f);
  if (!control || codePoint === 0) return false;
  return codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0c && codePoint !== 0x0d;
}

function inputError(codePoint: number): HtmlParseErrorCode | null {
  if (isSurrogate(codePoint)) return "surrogate-in-input-stream";
  if (isNoncharacter(codePoint)) return "noncharacter-in-input-stream";
  if (isDisallowedControl(codePoint)) return "control-character-in-input-stream";
  return null;
}

/**
 * Incremental decoded-input queue with lazy newline normalization.
 * @see https://html.spec.whatwg.org/multipage/parsing.html#preprocessing-the-input-stream
 */
export class HtmlInputCursor {
  readonly #guard: EngineResourceGuard;
  readonly #onParseError: InputParseErrorObserver | undefined;
  #chunks: string[] = [];
  #headChunk = 0;
  #headOffset = 0;
  #utf16Offset = 0;
  #writtenCodeUnits = 0;
  #closed = false;
  #current: InputCharacter | null = null;
  #reconsumePending = false;

  constructor(guard: EngineResourceGuard, onParseError?: InputParseErrorObserver) {
    this.#guard = guard;
    this.#onParseError = onParseError;
  }

  /** Appends decoded input without normalizing or joining retained chunks. */
  write(chunk: string): void {
    if (typeof chunk !== "string") {
      throw new EngineConfigurationError("chunk", "must be a string");
    }
    if (this.#closed) {
      throw new EngineConfigurationError("cursor", "cannot accept input after close");
    }
    this.#guard.checkpoint();
    const nextWrittenCodeUnits = this.#writtenCodeUnits + chunk.length;
    if (!Number.isSafeInteger(nextWrittenCodeUnits)) {
      throw new EngineConfigurationError("input", "must fit in a safe UTF-16 code-unit count");
    }
    if (chunk.length > 0) this.#chunks.push(chunk);
    this.#writtenCodeUnits = nextWrittenCodeUnits;
  }

  /** Closes the input stream; subsequent exhaustion produces conceptual EOF. */
  close(): void {
    if (this.#closed) return;
    this.#guard.checkpoint();
    this.#closed = true;
  }

  /** Returns the next decoded UTF-16 position. */
  position(): SourcePosition {
    return sourcePosition(this.#utf16Offset);
  }

  /** Makes the current character the next consume result without duplicating diagnostics. */
  reconsumeCurrent(): void {
    if (this.#current === null || this.#reconsumePending) {
      throw new EngineConfigurationError("cursor", "requires one consumed character to reconsume");
    }
    this.#reconsumePending = true;
  }

  /** Consumes one normalized code point, reports a boundary wait, or returns conceptual EOF. */
  consume(): InputRead {
    this.#guard.checkpoint();
    if (this.#reconsumePending) {
      this.#reconsumePending = false;
      return this.#current as InputCharacter;
    }

    const first = this.#codeUnitAt(0);
    if (first === undefined) {
      const position = this.position();
      return Object.freeze(
        this.#closed ? { kind: "eof", position } : { kind: "need-more-input", position }
      );
    }

    const second = this.#codeUnitAt(1);
    let width = 1;
    let codePoint = first;
    let value: string;
    if (first === 0x0d) {
      if (second === undefined && !this.#closed) {
        return Object.freeze({ kind: "need-more-input", position: this.position() });
      }
      if (second === 0x0a) width = 2;
      value = "\n";
    } else if (isLeadingSurrogate(first)) {
      if (second === undefined && !this.#closed) {
        return Object.freeze({ kind: "need-more-input", position: this.position() });
      }
      if (second !== undefined && isTrailingSurrogate(second)) {
        width = 2;
        codePoint = ((first - 0xd800) << 10) + (second - 0xdc00) + 0x10000;
        value = String.fromCodePoint(codePoint);
      } else {
        value = String.fromCharCode(first);
      }
    } else {
      value = String.fromCharCode(first);
    }

    const span = sourceSpan(this.#utf16Offset, this.#utf16Offset + width);
    const parseErrorCode = inputError(codePoint);
    if (parseErrorCode !== null) {
      this.#guard.reserveParseError();
      const diagnostic = createParseError(parseErrorCode, "preprocessing", span);
      this.#onParseError?.(diagnostic);
      this.#guard.ensureActive();
    }

    this.#advance(width);
    const result = Object.freeze({ kind: "character", value, span } as const);
    this.#current = result;
    return result;
  }

  #codeUnitAt(distance: number): number | undefined {
    let chunkIndex = this.#headChunk;
    let chunkOffset = this.#headOffset;
    let remaining = distance;
    while (chunkIndex < this.#chunks.length) {
      const chunk = this.#chunks[chunkIndex];
      if (chunk === undefined) return undefined;
      const available = chunk.length - chunkOffset;
      if (remaining < available) return chunk.charCodeAt(chunkOffset + remaining);
      remaining -= available;
      chunkIndex += 1;
      chunkOffset = 0;
    }
    return undefined;
  }

  #advance(codeUnits: number): void {
    let remaining = codeUnits;
    while (remaining > 0) {
      const chunk = this.#chunks[this.#headChunk];
      if (chunk === undefined) {
        throw new Error("Input cursor invariant violated: advance exceeded buffered input");
      }
      const available = chunk.length - this.#headOffset;
      const consumed = Math.min(available, remaining);
      this.#headOffset += consumed;
      this.#utf16Offset += consumed;
      remaining -= consumed;
      if (this.#headOffset === chunk.length) {
        this.#chunks[this.#headChunk] = "";
        this.#headChunk += 1;
        this.#headOffset = 0;
      }
    }
    if (this.#headChunk >= 1024 && this.#headChunk * 2 >= this.#chunks.length) {
      this.#chunks = this.#chunks.slice(this.#headChunk);
      this.#headChunk = 0;
    }
  }
}
