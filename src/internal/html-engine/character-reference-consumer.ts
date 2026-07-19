import { failInternalState } from "../foundation/internal-state-error.js";

import { createParseError, type EngineParseError, type HtmlParseErrorCode } from "./diagnostics.js";
import { type HtmlInputCursor } from "./input-cursor.js";
import {
  MAX_NAMED_CHARACTER_REFERENCE_LENGTH,
  probeNamedCharacterReference
} from "./named-character-references.js";
import { sourceSpan, type SourcePosition, type SourceSpan } from "./positions.js";
import {
  EngineConfigurationError,
  type EngineResourceGuard
} from "./resource-guard.js";

/** Tokenizer return-state information that changes character-reference behavior. */
export type CharacterReferenceContext = "text" | "attribute";

export interface CharacterReferenceConsumerOptions {
  readonly context: CharacterReferenceContext;
  readonly ampersandSpan: SourceSpan;
  readonly additionalAllowedCharacter?: string | null;
  readonly onParseError?: (error: EngineParseError) => void;
}

export interface CharacterReferenceNeedMore {
  readonly kind: "need-more-input";
  readonly consumedUtf16: number;
  readonly position: SourcePosition;
}

export interface CharacterReferenceLiteral {
  readonly kind: "literal";
  readonly value: string;
  readonly consumedUtf16: number;
  readonly span: SourceSpan;
  readonly errors: readonly EngineParseError[];
}

export interface CharacterReferenceResolved {
  readonly kind: "resolved";
  readonly source: "named" | "numeric";
  readonly value: string;
  readonly consumedUtf16: number;
  readonly span: SourceSpan;
  readonly errors: readonly EngineParseError[];
}

export type CharacterReferenceResult =
  | CharacterReferenceNeedMore
  | CharacterReferenceLiteral
  | CharacterReferenceResolved;

/** Deterministic work and retained-state observations for focused qualification. */
export interface CharacterReferenceConsumerMetrics {
  readonly namedLookups: number;
  readonly namedLookupComparisons: number;
  readonly maximumNamedCandidateCodeUnits: number;
  readonly numericDigits: number;
  readonly literalCodeUnits: number;
}

type ConsumerState =
  | "start"
  | "named"
  | "ambiguous"
  | "numeric-start"
  | "hexadecimal-start"
  | "decimal"
  | "hexadecimal";

interface NamedMatch {
  readonly name: string;
  readonly value: string;
}

const SATURATED_NUMERIC_VALUE = 0x110000;

function isAsciiAlphanumeric(codeUnit: number): boolean {
  return (codeUnit >= 0x30 && codeUnit <= 0x39) ||
    (codeUnit >= 0x41 && codeUnit <= 0x5a) ||
    (codeUnit >= 0x61 && codeUnit <= 0x7a);
}

function isAsciiWhitespace(codeUnit: number): boolean {
  return codeUnit === 0x09 ||
    codeUnit === 0x0a ||
    codeUnit === 0x0c ||
    codeUnit === 0x0d ||
    codeUnit === 0x20;
}

function decimalDigitValue(codeUnit: number): number | null {
  return codeUnit >= 0x30 && codeUnit <= 0x39 ? codeUnit - 0x30 : null;
}

function hexadecimalDigitValue(codeUnit: number): number | null {
  if (codeUnit >= 0x30 && codeUnit <= 0x39) return codeUnit - 0x30;
  if (codeUnit >= 0x41 && codeUnit <= 0x46) return codeUnit - 0x41 + 10;
  if (codeUnit >= 0x61 && codeUnit <= 0x66) return codeUnit - 0x61 + 10;
  return null;
}

function isSurrogate(codePoint: number): boolean {
  return codePoint >= 0xd800 && codePoint <= 0xdfff;
}

function isNoncharacter(codePoint: number): boolean {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
    (codePoint >= 0xfffe && codePoint <= 0x10ffff && (codePoint & 0xffff) >= 0xfffe);
}

function isControl(codePoint: number): boolean {
  return (codePoint >= 0x00 && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f);
}

function isAsciiWhitespaceCodePoint(codePoint: number): boolean {
  return codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0c ||
    codePoint === 0x0d ||
    codePoint === 0x20;
}

function windows1252Replacement(codePoint: number): number | null {
  switch (codePoint) {
    case 0x80: return 0x20ac;
    case 0x82: return 0x201a;
    case 0x83: return 0x0192;
    case 0x84: return 0x201e;
    case 0x85: return 0x2026;
    case 0x86: return 0x2020;
    case 0x87: return 0x2021;
    case 0x88: return 0x02c6;
    case 0x89: return 0x2030;
    case 0x8a: return 0x0160;
    case 0x8b: return 0x2039;
    case 0x8c: return 0x0152;
    case 0x8e: return 0x017d;
    case 0x91: return 0x2018;
    case 0x92: return 0x2019;
    case 0x93: return 0x201c;
    case 0x94: return 0x201d;
    case 0x95: return 0x2022;
    case 0x96: return 0x2013;
    case 0x97: return 0x2014;
    case 0x98: return 0x02dc;
    case 0x99: return 0x2122;
    case 0x9a: return 0x0161;
    case 0x9b: return 0x203a;
    case 0x9c: return 0x0153;
    case 0x9e: return 0x017e;
    case 0x9f: return 0x0178;
    default: return null;
  }
}

/**
 * Incrementally consumes the HTML character-reference states after a caller-owned ampersand.
 * @see https://html.spec.whatwg.org/multipage/parsing.html#character-reference-state
 */
export class CharacterReferenceConsumer {
  readonly #cursor: HtmlInputCursor;
  readonly #guard: EngineResourceGuard;
  readonly #context: CharacterReferenceContext;
  readonly #ampersandSpan: SourceSpan;
  readonly #additionalAllowedCodeUnit: number | null;
  readonly #onParseError: ((error: EngineParseError) => void) | undefined;
  #state: ConsumerState = "start";
  #errors: EngineParseError[] = [];
  #consumedUtf16 = 0;
  #result: CharacterReferenceLiteral | CharacterReferenceResolved | null = null;
  #namedCandidate = "";
  #namedScanDistance = 0;
  #lastNamedMatch: NamedMatch | null = null;
  #ambiguousParts: string[] = [];
  #ambiguousPart = "&";
  #ambiguousLength = 1;
  #numericPrefix = "#";
  #numericValue = 0;
  #numericDigits = 0;
  #namedLookups = 0;
  #namedLookupComparisons = 0;
  #maximumNamedCandidateCodeUnits = 0;
  #stepping = false;
  #failed = false;
  #failure: unknown;

  constructor(
    cursor: HtmlInputCursor,
    guard: EngineResourceGuard,
    options: CharacterReferenceConsumerOptions
  ) {
    const context: unknown = options.context;
    if (context !== "text" && context !== "attribute") {
      throw new EngineConfigurationError("character reference context", "must be text or attribute");
    }
    const allowedCharacter = options.additionalAllowedCharacter ?? null;
    if (allowedCharacter !== null && allowedCharacter.length !== 1) {
      throw new EngineConfigurationError(
        "additional allowed character",
        "must be null or one UTF-16 code unit"
      );
    }
    if (options.onParseError !== undefined && typeof options.onParseError !== "function") {
      throw new EngineConfigurationError("character reference parse-error observer", "must be a function");
    }
    const { startUtf16Offset, endUtf16Offset } = options.ampersandSpan;
    if (
      !Number.isSafeInteger(startUtf16Offset) ||
      !Number.isSafeInteger(endUtf16Offset) ||
      startUtf16Offset < 0 ||
      endUtf16Offset !== startUtf16Offset + 1 ||
      cursor.position().utf16Offset !== endUtf16Offset
    ) {
      throw new EngineConfigurationError(
        "ampersand span",
        "must cover the immediately preceding UTF-16 code unit"
      );
    }

    guard.ensureActive();
    this.#cursor = cursor;
    this.#guard = guard;
    this.#context = context;
    this.#ampersandSpan = sourceSpan(startUtf16Offset, endUtf16Offset);
    this.#additionalAllowedCodeUnit = allowedCharacter === null
      ? null
      : allowedCharacter.charCodeAt(0);
    this.#onParseError = options.onParseError;
  }

  /** Advances until the reference completes or requires another decoded-input chunk. */
  step(): CharacterReferenceResult {
    if (this.#result !== null) return this.#result;
    if (this.#failed) throw this.#failure;
    if (this.#stepping) {
      throw new EngineConfigurationError("character reference consumer", "cannot be reentered");
    }
    this.#stepping = true;
    try {
      return this.#advance();
    } catch (error) {
      this.#failed = true;
      this.#failure = error;
      throw error;
    } finally {
      this.#stepping = false;
    }
  }

  #advance(): CharacterReferenceResult {
    for (;;) {
      switch (this.#state) {
        case "start": {
          const read = this.#cursor.peekCodeUnit();
          if (read.kind === "need-more-input") return this.#needMore();
          if (read.kind === "eof") return this.#finishLiteral("&");
          if (
            isAsciiWhitespace(read.value) ||
            read.value === 0x3c ||
            read.value === 0x26 ||
            read.value === this.#additionalAllowedCodeUnit
          ) {
            return this.#finishLiteral("&");
          }
          if (read.value === 0x23) {
            this.#consumeAsciiCodeUnits(1);
            this.#state = "numeric-start";
          } else {
            this.#state = "named";
          }
          break;
        }

        case "named": {
          const read = this.#cursor.peekCodeUnit(this.#namedScanDistance);
          if (read.kind === "need-more-input") return this.#needMore();
          if (read.kind === "eof") {
            const result = this.#completeNamedCandidate();
            if (result !== null) return result;
            break;
          }

          const character = String.fromCharCode(read.value);
          this.#namedCandidate += character;
          this.#namedScanDistance += 1;
          this.#maximumNamedCandidateCodeUnits = Math.max(
            this.#maximumNamedCandidateCodeUnits,
            this.#namedCandidate.length
          );
          const probe = probeNamedCharacterReference(this.#namedCandidate);
          this.#namedLookups += 1;
          this.#namedLookupComparisons += probe.comparisons;
          if (probe.value !== null) {
            this.#lastNamedMatch = Object.freeze({
              name: this.#namedCandidate,
              value: probe.value
            });
          }
          if (
            !probe.hasPrefix ||
            character === ";" ||
            this.#namedScanDistance >= MAX_NAMED_CHARACTER_REFERENCE_LENGTH
          ) {
            const result = this.#completeNamedCandidate();
            if (result !== null) return result;
          }
          break;
        }

        case "ambiguous": {
          const read = this.#cursor.peekCodeUnit();
          if (read.kind === "need-more-input") return this.#needMore();
          if (read.kind === "eof") return this.#finishLiteral(this.#ambiguousValue());
          if (isAsciiAlphanumeric(read.value)) {
            this.#consumeAsciiCodeUnits(1);
            this.#appendAmbiguous(String.fromCharCode(read.value));
            break;
          }
          if (read.value === 0x3b) {
            this.#emitError(
              "unknown-named-character-reference",
              sourceSpan(read.position.utf16Offset, read.position.utf16Offset + 1)
            );
          }
          return this.#finishLiteral(this.#ambiguousValue());
        }

        case "numeric-start": {
          const read = this.#cursor.peekCodeUnit();
          if (read.kind === "need-more-input") return this.#needMore();
          if (read.kind === "eof") return this.#finishNumericWithoutDigits();
          if (read.value === 0x78 || read.value === 0x58) {
            this.#numericPrefix += String.fromCharCode(read.value);
            this.#consumeAsciiCodeUnits(1);
            this.#state = "hexadecimal-start";
          } else {
            this.#state = "decimal";
          }
          break;
        }

        case "hexadecimal-start": {
          const read = this.#cursor.peekCodeUnit();
          if (read.kind === "need-more-input") return this.#needMore();
          if (read.kind === "eof") return this.#finishNumericWithoutDigits();
          if (hexadecimalDigitValue(read.value) === null) {
            return this.#finishNumericWithoutDigits();
          }
          this.#state = "hexadecimal";
          break;
        }

        case "decimal":
        case "hexadecimal": {
          const read = this.#cursor.peekCodeUnit();
          if (read.kind === "need-more-input") return this.#needMore();
          if (read.kind === "eof") {
            if (this.#numericDigits === 0) return this.#finishNumericWithoutDigits();
            this.#emitDecisionError("missing-semicolon-after-character-reference");
            return this.#finishNumericValue();
          }

          const radix = this.#state === "decimal" ? 10 : 16;
          const digit = radix === 10
            ? decimalDigitValue(read.value)
            : hexadecimalDigitValue(read.value);
          if (digit !== null) {
            this.#consumeAsciiCodeUnits(1);
            this.#accumulateNumericDigit(radix, digit);
            break;
          }
          if (this.#numericDigits === 0) return this.#finishNumericWithoutDigits();
          if (read.value === 0x3b) {
            this.#consumeAsciiCodeUnits(1);
          } else {
            this.#emitDecisionError("missing-semicolon-after-character-reference");
          }
          return this.#finishNumericValue();
        }
      }
    }
  }

  /** Returns immutable implementation evidence without exposing mutable state. */
  metrics(): CharacterReferenceConsumerMetrics {
    return Object.freeze({
      namedLookups: this.#namedLookups,
      namedLookupComparisons: this.#namedLookupComparisons,
      maximumNamedCandidateCodeUnits: this.#maximumNamedCandidateCodeUnits,
      numericDigits: this.#numericDigits,
      literalCodeUnits: this.#ambiguousLength
    });
  }

  #completeNamedCandidate(): CharacterReferenceResult | null {
    const match = this.#lastNamedMatch;
    if (match === null) {
      this.#state = "ambiguous";
      return null;
    }

    const endsWithSemicolon = match.name.endsWith(";");
    if (this.#context === "attribute" && !endsWithSemicolon) {
      const following = this.#cursor.peekCodeUnit(match.name.length);
      if (following.kind === "need-more-input") return this.#needMore();
      if (
        following.kind === "code-unit" &&
        (isAsciiAlphanumeric(following.value) || following.value === 0x3d)
      ) {
        this.#consumeAsciiCodeUnits(match.name.length);
        return this.#finishLiteral(`&${match.name}`);
      }
    }

    this.#consumeAsciiCodeUnits(match.name.length);
    if (!endsWithSemicolon) {
      this.#emitDecisionError("missing-semicolon-after-character-reference");
    }
    return this.#finishResolved("named", match.value);
  }

  #consumeAsciiCodeUnits(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const read = this.#cursor.consume();
      if (
        read.kind !== "character" ||
        read.value.length !== 1 ||
        read.span.endUtf16Offset !== read.span.startUtf16Offset + 1 ||
        read.value.charCodeAt(0) > 0x7f
      ) {
        failInternalState("CHARACTER_REFERENCE_ASCII_CONSUMPTION_MISMATCH");
      }
      this.#consumedUtf16 += 1;
    }
  }

  #appendAmbiguous(character: string): void {
    this.#ambiguousPart += character;
    this.#ambiguousLength += 1;
    if (this.#ambiguousPart.length >= 1024) {
      this.#ambiguousParts.push(this.#ambiguousPart);
      this.#ambiguousPart = "";
    }
  }

  #ambiguousValue(): string {
    return [...this.#ambiguousParts, this.#ambiguousPart].join("");
  }

  #accumulateNumericDigit(radix: number, digit: number): void {
    this.#numericDigits += 1;
    if (this.#numericValue === SATURATED_NUMERIC_VALUE) return;
    if (this.#numericValue > Math.floor((0x10ffff - digit) / radix)) {
      this.#numericValue = SATURATED_NUMERIC_VALUE;
      return;
    }
    this.#numericValue = this.#numericValue * radix + digit;
  }

  #finishNumericWithoutDigits(): CharacterReferenceLiteral {
    this.#emitDecisionError("absence-of-digits-in-numeric-character-reference");
    return this.#finishLiteral(`&${this.#numericPrefix}`);
  }

  #finishNumericValue(): CharacterReferenceResolved {
    const span = this.#resultSpan();
    let codePoint = this.#numericValue;
    if (codePoint === 0) {
      this.#emitError("null-character-reference", span);
      codePoint = 0xfffd;
    } else if (codePoint > 0x10ffff) {
      this.#emitError("character-reference-outside-unicode-range", span);
      codePoint = 0xfffd;
    } else if (isSurrogate(codePoint)) {
      this.#emitError("surrogate-character-reference", span);
      codePoint = 0xfffd;
    } else {
      if (isNoncharacter(codePoint)) {
        this.#emitError("noncharacter-character-reference", span);
      }
      if (codePoint === 0x0d || (isControl(codePoint) && !isAsciiWhitespaceCodePoint(codePoint))) {
        this.#emitError("control-character-reference", span);
        codePoint = windows1252Replacement(codePoint) ?? codePoint;
      }
    }
    return this.#finishResolved("numeric", String.fromCodePoint(codePoint));
  }

  #emitDecisionError(code: HtmlParseErrorCode): void {
    const position = this.#cursor.position().utf16Offset;
    this.#emitError(code, sourceSpan(position, position));
  }

  #emitError(code: HtmlParseErrorCode, span: SourceSpan): void {
    this.#guard.reserveParseError();
    const error = createParseError(code, "tokenizer", span);
    this.#errors.push(error);
    this.#onParseError?.(error);
    this.#guard.ensureActive();
  }

  #needMore(): CharacterReferenceNeedMore {
    return Object.freeze({
      kind: "need-more-input",
      consumedUtf16: this.#consumedUtf16,
      position: this.#cursor.position()
    });
  }

  #resultSpan(): SourceSpan {
    return sourceSpan(this.#ampersandSpan.startUtf16Offset, this.#cursor.position().utf16Offset);
  }

  #finishLiteral(value: string): CharacterReferenceLiteral {
    const result: CharacterReferenceLiteral = Object.freeze({
      kind: "literal",
      value,
      consumedUtf16: this.#consumedUtf16,
      span: this.#resultSpan(),
      errors: Object.freeze([...this.#errors])
    });
    this.#result = result;
    return result;
  }

  #finishResolved(source: "named" | "numeric", value: string): CharacterReferenceResolved {
    const result: CharacterReferenceResolved = Object.freeze({
      kind: "resolved",
      source,
      value,
      consumedUtf16: this.#consumedUtf16,
      span: this.#resultSpan(),
      errors: Object.freeze([...this.#errors])
    });
    this.#result = result;
    return result;
  }
}
