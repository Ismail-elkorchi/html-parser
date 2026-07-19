import { CharacterReferenceConsumer } from "../character-reference-consumer.js";
import { createParseError, type EngineParseError, type HtmlParseErrorCode } from "../diagnostics.js";
import { HtmlInputCursor, type InputCharacter, type InputEof, type InputRead } from "../input-cursor.js";
import { type EngineObserver, type TokenSink, type TokenizerControl } from "../observer.js";
import { type TokenizerMode } from "../parser-state.js";
import { sourceSpan, type SourcePosition, type SourceSpan } from "../positions.js";
import { EngineConfigurationError, type EngineResourceGuard } from "../resource-guard.js";
import { type HtmlToken } from "../tokens.js";

import { CommentTokenBuilder, DoctypeTokenBuilder, TagTokenBuilder } from "./builders.js";
import {
  EngineUnsupportedTokenizerStateError,
  type HtmlTokenizerState
} from "./state.js";

/** Tokenization stopped at an open decoded-input boundary. */
export interface HtmlTokenizerNeedMore {
  readonly status: "need-more-input";
  readonly position: SourcePosition;
  readonly state: HtmlTokenizerState;
}

/** Tokenization emitted its sole end-of-file token. */
export interface HtmlTokenizerDone {
  readonly status: "done";
  readonly position: SourcePosition;
}

export type HtmlTokenizerRunResult = HtmlTokenizerNeedMore | HtmlTokenizerDone;

export interface HtmlTokenizerOptions {
  readonly mode?: TokenizerMode;
  readonly lastStartTagName?: string | null;
  readonly foreignContent?: boolean;
  readonly observer?: EngineObserver;
}

type StepResult = HtmlTokenizerRunResult | null;
type TextState = "data-state" | "rcdata-state" | "rawtext-state" | "script-data-state" | "plaintext-state";
type AttributeValueState =
  | "attribute-value-(double-quoted)-state"
  | "attribute-value-(single-quoted)-state"
  | "attribute-value-(unquoted)-state";

interface CharacterReferenceReturn {
  readonly state: "data-state" | "rcdata-state" | AttributeValueState;
  readonly context: "text" | "attribute";
}

interface KeywordProbeMatch {
  readonly kind: "match";
  readonly value: string;
}

interface KeywordProbeNeedMore {
  readonly kind: "need-more-input";
  readonly position: SourcePosition;
}

interface KeywordProbeNoMatch {
  readonly kind: "no-match";
}

type KeywordProbe = KeywordProbeMatch | KeywordProbeNeedMore | KeywordProbeNoMatch;

const WHITESPACE = new Set(["\t", "\n", "\f", " "]);

function isAsciiWhitespace(value: string): boolean {
  return WHITESPACE.has(value);
}

function isAsciiAlpha(value: string): boolean {
  if (value.length !== 1) return false;
  const code = value.charCodeAt(0);
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isAsciiUpper(value: string): boolean {
  if (value.length !== 1) return false;
  const code = value.charCodeAt(0);
  return code >= 0x41 && code <= 0x5a;
}

function asciiLower(value: string): string {
  return isAsciiUpper(value)
    ? String.fromCharCode(value.charCodeAt(0) + 0x20)
    : value;
}

function modeState(mode: TokenizerMode): TextState {
  switch (mode) {
    case "data": return "data-state";
    case "rcdata": return "rcdata-state";
    case "rawtext": return "rawtext-state";
    case "script-data": return "script-data-state";
    case "plaintext": return "plaintext-state";
  }
}

function validateMode(value: unknown): TokenizerMode {
  if (
    value !== "data" &&
    value !== "rcdata" &&
    value !== "rawtext" &&
    value !== "script-data" &&
    value !== "plaintext"
  ) {
    throw new EngineConfigurationError("tokenizer mode", "must be a supported tokenizer mode");
  }
  return value;
}

function decisionSpan(read: InputCharacter | InputEof): SourceSpan {
  return read.kind === "character"
    ? read.span
    : sourceSpan(read.position.utf16Offset, read.position.utf16Offset);
}

/**
 * Incremental, isolated tokenizer for the pinned HTML Standard state machine.
 * This class is intentionally absent from production and package entrypoints.
 */
export class HtmlTokenizer implements TokenizerControl {
  readonly #guard: EngineResourceGuard;
  readonly #sink: TokenSink;
  readonly #observer: EngineObserver | undefined;
  readonly #cursor: HtmlInputCursor;
  #state: HtmlTokenizerState;
  #lastStartTagName: string | null;
  #foreignContent: boolean;
  #closed = false;
  #done = false;
  #running = false;
  #failed = false;
  #failure: unknown;
  #markupStartUtf16Offset = 0;
  #characterParts: string[] = [];
  #characterStartUtf16Offset: number | null = null;
  #characterEndUtf16Offset: number | null = null;
  #tag: TagTokenBuilder | null = null;
  #comment: CommentTokenBuilder | null = null;
  #doctype: DoctypeTokenBuilder | null = null;
  #characterReference: CharacterReferenceConsumer | null = null;
  #characterReferenceReturn: CharacterReferenceReturn | null = null;

  constructor(guard: EngineResourceGuard, sink: TokenSink, options: HtmlTokenizerOptions = {}) {
    const unknownSink: unknown = sink;
    if (
      typeof unknownSink !== "object" ||
      unknownSink === null ||
      Array.isArray(unknownSink) ||
      typeof (unknownSink as { readonly accept?: unknown }).accept !== "function"
    ) {
      throw new EngineConfigurationError("token sink", "must provide an accept function");
    }
    const unknownOptions: unknown = options;
    if (typeof unknownOptions !== "object" || unknownOptions === null || Array.isArray(unknownOptions)) {
      throw new EngineConfigurationError("tokenizer options", "must be an object");
    }
    const record = unknownOptions as Readonly<Record<PropertyKey, unknown>>;
    const allowed = new Set<PropertyKey>(["mode", "lastStartTagName", "foreignContent", "observer"]);
    for (const key of Reflect.ownKeys(record)) {
      if (!allowed.has(key)) {
        throw new EngineConfigurationError(`tokenizer options.${String(key)}`, "is not supported");
      }
    }
    const mode = validateMode(options.mode ?? "data");
    if (
      options.lastStartTagName !== undefined &&
      options.lastStartTagName !== null &&
      typeof options.lastStartTagName !== "string"
    ) {
      throw new EngineConfigurationError("last start tag name", "must be a string or null");
    }
    if (options.foreignContent !== undefined && typeof options.foreignContent !== "boolean") {
      throw new EngineConfigurationError("foreign content", "must be a boolean");
    }
    this.#validateObserver(options.observer);
    guard.ensureActive();
    this.#guard = guard;
    this.#sink = sink;
    this.#observer = options.observer;
    this.#state = modeState(mode);
    this.#lastStartTagName = options.lastStartTagName ?? null;
    this.#foreignContent = options.foreignContent ?? false;
    this.#cursor = new HtmlInputCursor(guard, (error) => {
      this.#observeParseError(error);
    });
  }

  /** Appends one decoded-input chunk and advances until another chunk is required. */
  write(chunk: string): HtmlTokenizerRunResult {
    if (this.#done) {
      throw new EngineConfigurationError("tokenizer", "cannot accept input after completion");
    }
    return this.#invoke(() => {
      if (this.#closed) {
        throw new EngineConfigurationError("tokenizer", "cannot accept input after close");
      }
      this.#cursor.write(chunk);
      return this.#advance();
    });
  }

  /** Advances already-buffered input without appending a chunk. */
  run(): HtmlTokenizerRunResult {
    return this.#invoke(() => this.#advance());
  }

  /** Closes decoded input and advances through exactly one EOF emission. */
  close(): HtmlTokenizerRunResult {
    return this.#invoke(() => {
      if (!this.#closed) {
        this.#cursor.close();
        this.#closed = true;
      }
      return this.#advance();
    });
  }

  setMode(mode: TokenizerMode): void {
    this.#ensureUsable();
    this.#guard.ensureActive();
    this.#state = modeState(validateMode(mode));
  }

  setLastStartTagName(name: string | null): void {
    this.#ensureUsable();
    if (name !== null && typeof name !== "string") {
      throw new EngineConfigurationError("last start tag name", "must be a string or null");
    }
    this.#guard.ensureActive();
    this.#lastStartTagName = name;
  }

  setForeignContent(enabled: boolean): void {
    this.#ensureUsable();
    if (typeof enabled !== "boolean") {
      throw new EngineConfigurationError("foreign content", "must be a boolean");
    }
    this.#guard.ensureActive();
    this.#foreignContent = enabled;
  }

  state(): HtmlTokenizerState {
    return this.#state;
  }

  lastStartTagName(): string | null {
    return this.#lastStartTagName;
  }

  #invoke(operation: () => HtmlTokenizerRunResult): HtmlTokenizerRunResult {
    if (this.#failed) throw this.#failure;
    if (this.#running) {
      throw new EngineConfigurationError("tokenizer", "cannot be reentered");
    }
    if (this.#done) {
      return Object.freeze({ status: "done", position: this.#cursor.position() });
    }
    this.#running = true;
    try {
      return operation();
    } catch (error) {
      this.#failed = true;
      this.#failure = error;
      throw error;
    } finally {
      this.#running = false;
    }
  }

  #advance(): HtmlTokenizerRunResult {
    for (;;) {
      const result = this.#step();
      if (result !== null) return result;
    }
  }

  #step(): StepResult {
    switch (this.#state) {
      case "data-state": return this.#stepData();
      case "rcdata-state": return this.#stepRcdata();
      case "rawtext-state": return this.#stepRawtext();
      case "script-data-state": return this.#stepScriptData();
      case "plaintext-state": return this.#stepPlaintext();
      case "tag-open-state": return this.#stepTagOpen();
      case "end-tag-open-state": return this.#stepEndTagOpen();
      case "tag-name-state": return this.#stepTagName();
      case "before-attribute-name-state": return this.#stepBeforeAttributeName();
      case "attribute-name-state": return this.#stepAttributeName();
      case "after-attribute-name-state": return this.#stepAfterAttributeName();
      case "before-attribute-value-state": return this.#stepBeforeAttributeValue();
      case "attribute-value-(double-quoted)-state": return this.#stepQuotedAttributeValue('"');
      case "attribute-value-(single-quoted)-state": return this.#stepQuotedAttributeValue("'");
      case "attribute-value-(unquoted)-state": return this.#stepUnquotedAttributeValue();
      case "after-attribute-value-(quoted)-state": return this.#stepAfterQuotedAttributeValue();
      case "self-closing-start-tag-state": return this.#stepSelfClosingStartTag();
      case "bogus-comment-state": return this.#stepBogusComment();
      case "markup-declaration-open-state": return this.#stepMarkupDeclarationOpen();
      case "comment-start-state": return this.#stepCommentStart();
      case "comment-start-dash-state": return this.#stepCommentStartDash();
      case "comment-state": return this.#stepComment();
      case "comment-less-than-sign-state": return this.#stepCommentLessThanSign();
      case "comment-less-than-sign-bang-state": return this.#stepCommentLessThanSignBang();
      case "comment-less-than-sign-bang-dash-state": return this.#stepCommentLessThanSignBangDash();
      case "comment-less-than-sign-bang-dash-dash-state": return this.#stepCommentLessThanSignBangDashDash();
      case "comment-end-dash-state": return this.#stepCommentEndDash();
      case "comment-end-state": return this.#stepCommentEnd();
      case "comment-end-bang-state": return this.#stepCommentEndBang();
      case "doctype-state": return this.#stepDoctype();
      case "before-doctype-name-state": return this.#stepBeforeDoctypeName();
      case "doctype-name-state": return this.#stepDoctypeName();
      case "after-doctype-name-state": return this.#stepAfterDoctypeName();
      case "after-doctype-public-keyword-state": return this.#stepAfterDoctypeKeyword("public");
      case "before-doctype-public-identifier-state": return this.#stepBeforeDoctypeIdentifier("public");
      case "doctype-public-identifier-(double-quoted)-state": return this.#stepDoctypeIdentifier("public", '"');
      case "doctype-public-identifier-(single-quoted)-state": return this.#stepDoctypeIdentifier("public", "'");
      case "after-doctype-public-identifier-state": return this.#stepAfterDoctypePublicIdentifier();
      case "between-doctype-public-and-system-identifiers-state": return this.#stepBetweenDoctypeIdentifiers();
      case "after-doctype-system-keyword-state": return this.#stepAfterDoctypeKeyword("system");
      case "before-doctype-system-identifier-state": return this.#stepBeforeDoctypeIdentifier("system");
      case "doctype-system-identifier-(double-quoted)-state": return this.#stepDoctypeIdentifier("system", '"');
      case "doctype-system-identifier-(single-quoted)-state": return this.#stepDoctypeIdentifier("system", "'");
      case "after-doctype-system-identifier-state": return this.#stepAfterDoctypeSystemIdentifier();
      case "bogus-doctype-state": return this.#stepBogusDoctype();
      case "character-reference-state": return this.#stepCharacterReference();
      default: throw new EngineUnsupportedTokenizerStateError(this.#state);
    }
  }

  #stepData(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#emitEof(read.position);
    if (read.value === "&") {
      this.#startCharacterReference(read, { state: "data-state", context: "text" });
    } else if (read.value === "<") {
      this.#markupStartUtf16Offset = read.span.startUtf16Offset;
      this.#state = "tag-open-state";
    } else {
      if (read.value === "\0") this.#emitParseError("unexpected-null-character", read.span);
      this.#appendCharacters(read.value, read.span);
    }
    return null;
  }

  #stepRcdata(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#emitEof(read.position);
    if (read.value === "&") {
      this.#startCharacterReference(read, { state: "rcdata-state", context: "text" });
    } else if (read.value === "<") {
      this.#appendCharacters("", read.span);
      this.#state = "rcdata-less-than-sign-state";
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      this.#appendCharacters("\uFFFD", read.span);
    } else {
      this.#appendCharacters(read.value, read.span);
    }
    return null;
  }

  #stepRawtext(): StepResult {
    return this.#stepRawLike("rawtext-less-than-sign-state");
  }

  #stepScriptData(): StepResult {
    return this.#stepRawLike("script-data-less-than-sign-state");
  }

  #stepRawLike(lessThanState: "rawtext-less-than-sign-state" | "script-data-less-than-sign-state"): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#emitEof(read.position);
    if (read.value === "<") {
      this.#appendCharacters("", read.span);
      this.#state = lessThanState;
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      this.#appendCharacters("\uFFFD", read.span);
    } else {
      this.#appendCharacters(read.value, read.span);
    }
    return null;
  }

  #stepPlaintext(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#emitEof(read.position);
    if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      this.#appendCharacters("\uFFFD", read.span);
    } else {
      this.#appendCharacters(read.value, read.span);
    }
    return null;
  }

  #stepTagOpen(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-before-tag-name", decisionSpan(read));
      this.#appendCharacters("<", sourceSpan(this.#markupStartUtf16Offset, this.#markupStartUtf16Offset + 1));
      return this.#emitEof(read.position);
    }
    if (read.value === "!") {
      this.#state = "markup-declaration-open-state";
    } else if (read.value === "/") {
      this.#state = "end-tag-open-state";
    } else if (isAsciiAlpha(read.value)) {
      this.#tag = new TagTokenBuilder("start-tag", this.#markupStartUtf16Offset, this.#guard.beginStartTag());
      this.#cursor.reconsumeCurrent();
      this.#state = "tag-name-state";
    } else if (read.value === "?") {
      this.#state = "processing-instruction-open-state";
    } else {
      this.#emitParseError("invalid-first-character-of-tag-name", read.span);
      this.#appendCharacters("<", sourceSpan(this.#markupStartUtf16Offset, this.#markupStartUtf16Offset + 1));
      this.#cursor.reconsumeCurrent();
      this.#state = "data-state";
    }
    return null;
  }

  #stepEndTagOpen(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-before-tag-name", decisionSpan(read));
      this.#appendCharacters("</", sourceSpan(this.#markupStartUtf16Offset, this.#markupStartUtf16Offset + 2));
      return this.#emitEof(read.position);
    }
    if (isAsciiAlpha(read.value)) {
      this.#tag = new TagTokenBuilder("end-tag", this.#markupStartUtf16Offset, this.#guard.beginStartTag());
      this.#cursor.reconsumeCurrent();
      this.#state = "tag-name-state";
    } else if (read.value === ">") {
      this.#emitParseError("missing-end-tag-name", read.span);
      this.#state = "data-state";
    } else {
      this.#emitParseError("invalid-first-character-of-tag-name", read.span);
      this.#comment = new CommentTokenBuilder(this.#markupStartUtf16Offset);
      this.#cursor.reconsumeCurrent();
      this.#state = "bogus-comment-state";
    }
    return null;
  }

  #stepTagName(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-tag", decisionSpan(read));
      this.#tag = null;
      return this.#emitEof(read.position);
    }
    const tag = this.#requireTag();
    if (isAsciiWhitespace(read.value)) {
      this.#state = "before-attribute-name-state";
    } else if (read.value === "/") {
      this.#state = "self-closing-start-tag-state";
    } else if (read.value === ">") {
      this.#state = "data-state";
      this.#emitTag(read.span);
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      tag.appendName("\uFFFD");
    } else {
      tag.appendName(asciiLower(read.value));
    }
    return null;
  }

  #stepBeforeAttributeName(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && isAsciiWhitespace(read.value)) return null;
    if (read.kind === "eof" || read.value === "/" || read.value === ">") {
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "after-attribute-name-state";
      return read.kind === "eof" ? this.#stepAfterAttributeNameAtEof(read) : null;
    }
    const tag = this.#requireTag();
    tag.beginAttribute(read.span.startUtf16Offset);
    if (read.value === "=") {
      this.#emitParseError("unexpected-equals-sign-before-attribute-name", read.span);
      tag.appendAttributeName("=", read.span);
      this.#state = "attribute-name-state";
    } else {
      this.#cursor.reconsumeCurrent();
      this.#state = "attribute-name-state";
    }
    return null;
  }

  #stepAttributeName(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (
      read.kind === "eof" ||
      isAsciiWhitespace(read.value) ||
      read.value === "/" ||
      read.value === ">"
    ) {
      this.#finishAttributeName(decisionSpan(read));
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "after-attribute-name-state";
      return read.kind === "eof" ? this.#stepAfterAttributeNameAtEof(read) : null;
    }
    const tag = this.#requireTag();
    if (read.value === "=") {
      this.#finishAttributeName(read.span);
      tag.touchAttribute(read.span);
      tag.markAttributeValuePending(read.span.endUtf16Offset);
      this.#state = "before-attribute-value-state";
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      tag.appendAttributeName("\uFFFD", read.span);
    } else {
      if (read.value === '"' || read.value === "'" || read.value === "<") {
        this.#emitParseError("unexpected-character-in-attribute-name", read.span);
      }
      tag.appendAttributeName(asciiLower(read.value), read.span);
    }
    return null;
  }

  #stepAfterAttributeName(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#stepAfterAttributeNameAtEof(read);
    if (isAsciiWhitespace(read.value)) return null;
    const tag = this.#requireTag();
    if (read.value === "/") {
      this.#state = "self-closing-start-tag-state";
    } else if (read.value === "=") {
      tag.touchAttribute(read.span);
      tag.markAttributeValuePending(read.span.endUtf16Offset);
      this.#state = "before-attribute-value-state";
    } else if (read.value === ">") {
      this.#state = "data-state";
      this.#emitTag(read.span);
    } else {
      tag.beginAttribute(read.span.startUtf16Offset);
      this.#cursor.reconsumeCurrent();
      this.#state = "attribute-name-state";
    }
    return null;
  }

  #stepAfterAttributeNameAtEof(read: InputEof): StepResult {
    this.#emitParseError("eof-in-tag", decisionSpan(read));
    this.#tag = null;
    return this.#emitEof(read.position);
  }

  #stepBeforeAttributeValue(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && isAsciiWhitespace(read.value)) {
      this.#requireTag().markAttributeValuePending(read.span.endUtf16Offset);
      return null;
    }
    if (read.kind === "eof") {
      this.#state = "attribute-value-(unquoted)-state";
      return null;
    }
    const tag = this.#requireTag();
    tag.touchAttribute(read.span);
    if (read.value === '"') {
      tag.beginQuotedAttributeValue(read.span.endUtf16Offset);
      this.#state = "attribute-value-(double-quoted)-state";
    } else if (read.value === "'") {
      tag.beginQuotedAttributeValue(read.span.endUtf16Offset);
      this.#state = "attribute-value-(single-quoted)-state";
    } else if (read.value === ">") {
      this.#emitParseError("missing-attribute-value", read.span);
      tag.ensureEmptyAttributeValue(read.span.startUtf16Offset);
      this.#state = "data-state";
      this.#emitTag(read.span);
    } else {
      this.#cursor.reconsumeCurrent();
      this.#state = "attribute-value-(unquoted)-state";
    }
    return null;
  }

  #stepQuotedAttributeValue(quote: '"' | "'"): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-tag", decisionSpan(read));
      this.#tag = null;
      return this.#emitEof(read.position);
    }
    const tag = this.#requireTag();
    if (read.value === quote) {
      tag.touchAttribute(read.span);
      this.#state = "after-attribute-value-(quoted)-state";
    } else if (read.value === "&") {
      this.#startCharacterReference(read, {
        state: quote === '"'
          ? "attribute-value-(double-quoted)-state"
          : "attribute-value-(single-quoted)-state",
        context: "attribute"
      });
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      tag.appendAttributeValue("\uFFFD", read.span);
    } else {
      tag.appendAttributeValue(read.value, read.span);
    }
    return null;
  }

  #stepUnquotedAttributeValue(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-tag", decisionSpan(read));
      this.#tag = null;
      return this.#emitEof(read.position);
    }
    const tag = this.#requireTag();
    if (isAsciiWhitespace(read.value)) {
      this.#state = "before-attribute-name-state";
    } else if (read.value === "&") {
      this.#startCharacterReference(read, {
        state: "attribute-value-(unquoted)-state",
        context: "attribute"
      });
    } else if (read.value === ">") {
      this.#state = "data-state";
      this.#emitTag(read.span);
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      tag.appendAttributeValue("\uFFFD", read.span);
    } else {
      if (read.value === '"' || read.value === "'" || read.value === "<" || read.value === "=" || read.value === "`") {
        this.#emitParseError("unexpected-character-in-unquoted-attribute-value", read.span);
      }
      tag.appendAttributeValue(read.value, read.span);
    }
    return null;
  }

  #stepAfterQuotedAttributeValue(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-tag", decisionSpan(read));
      this.#tag = null;
      return this.#emitEof(read.position);
    }
    if (isAsciiWhitespace(read.value)) {
      this.#state = "before-attribute-name-state";
    } else if (read.value === "/") {
      this.#state = "self-closing-start-tag-state";
    } else if (read.value === ">") {
      this.#state = "data-state";
      this.#emitTag(read.span);
    } else {
      this.#emitParseError("missing-whitespace-between-attributes", read.span);
      this.#cursor.reconsumeCurrent();
      this.#state = "before-attribute-name-state";
    }
    return null;
  }

  #stepSelfClosingStartTag(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-tag", decisionSpan(read));
      this.#tag = null;
      return this.#emitEof(read.position);
    }
    if (read.value === ">") {
      this.#requireTag().setSelfClosing();
      this.#state = "data-state";
      this.#emitTag(read.span);
    } else {
      this.#emitParseError("unexpected-solidus-in-tag", read.span);
      this.#cursor.reconsumeCurrent();
      this.#state = "before-attribute-name-state";
    }
    return null;
  }

  #stepMarkupDeclarationOpen(): StepResult {
    const probe = this.#probeKeywords([
      { value: "--", caseInsensitive: false },
      { value: "DOCTYPE", caseInsensitive: true },
      { value: "[CDATA[", caseInsensitive: false }
    ]);
    if (probe.kind === "need-more-input") return this.#wait(probe.position);
    if (probe.kind === "match") {
      this.#consumeAscii(probe.value.length);
      if (probe.value === "--") {
        this.#comment = new CommentTokenBuilder(this.#markupStartUtf16Offset);
        this.#state = "comment-start-state";
      } else if (probe.value === "DOCTYPE") {
        this.#state = "doctype-state";
      } else if (this.#foreignContent) {
        this.#state = "cdata-section-state";
      } else {
        const end = this.#cursor.position().utf16Offset;
        this.#emitParseError(
          "cdata-in-html-content",
          sourceSpan(end - 1, end)
        );
        this.#comment = new CommentTokenBuilder(this.#markupStartUtf16Offset, "[CDATA[");
        this.#state = "bogus-comment-state";
      }
      return null;
    }
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character") this.#cursor.reconsumeCurrent();
    this.#emitParseError("incorrectly-opened-comment", decisionSpan(read));
    this.#comment = new CommentTokenBuilder(this.#markupStartUtf16Offset);
    this.#state = "bogus-comment-state";
    return null;
  }

  #stepBogusComment(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitComment(read.position.utf16Offset);
      return this.#emitEof(read.position);
    }
    if (read.value === ">") {
      this.#state = "data-state";
      this.#emitComment(read.span.endUtf16Offset);
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      this.#requireComment().append("\uFFFD");
    } else {
      this.#requireComment().append(read.value);
    }
    return null;
  }

  #stepCommentStart(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && read.value === "-") {
      this.#state = "comment-start-dash-state";
    } else if (read.kind === "character" && read.value === ">") {
      this.#emitParseError("abrupt-closing-of-empty-comment", read.span);
      this.#state = "data-state";
      this.#emitComment(read.span.endUtf16Offset);
    } else {
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "comment-state";
    }
    return null;
  }

  #stepCommentStartDash(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-comment", decisionSpan(read));
      this.#emitComment(read.position.utf16Offset);
      return this.#emitEof(read.position);
    }
    if (read.value === "-") {
      this.#state = "comment-end-state";
    } else if (read.value === ">") {
      this.#emitParseError("abrupt-closing-of-empty-comment", read.span);
      this.#state = "data-state";
      this.#emitComment(read.span.endUtf16Offset);
    } else {
      this.#requireComment().append("-");
      this.#cursor.reconsumeCurrent();
      this.#state = "comment-state";
    }
    return null;
  }

  #stepComment(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-comment", decisionSpan(read));
      this.#emitComment(read.position.utf16Offset);
      return this.#emitEof(read.position);
    }
    if (read.value === "<") {
      this.#requireComment().append("<");
      this.#state = "comment-less-than-sign-state";
    } else if (read.value === "-") {
      this.#state = "comment-end-dash-state";
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      this.#requireComment().append("\uFFFD");
    } else {
      this.#requireComment().append(read.value);
    }
    return null;
  }

  #stepCommentLessThanSign(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && read.value === "!") {
      this.#requireComment().append("!");
      this.#state = "comment-less-than-sign-bang-state";
    } else if (read.kind === "character" && read.value === "<") {
      this.#requireComment().append("<");
    } else {
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "comment-state";
    }
    return null;
  }

  #stepCommentLessThanSignBang(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && read.value === "-") {
      this.#state = "comment-less-than-sign-bang-dash-state";
    } else {
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "comment-state";
    }
    return null;
  }

  #stepCommentLessThanSignBangDash(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && read.value === "-") {
      this.#state = "comment-less-than-sign-bang-dash-dash-state";
    } else {
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "comment-end-dash-state";
    }
    return null;
  }

  #stepCommentLessThanSignBangDashDash(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && read.value !== ">") {
      this.#emitParseError("nested-comment", read.span);
    }
    if (read.kind === "character") this.#cursor.reconsumeCurrent();
    this.#state = "comment-end-state";
    return null;
  }

  #stepCommentEndDash(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-comment", decisionSpan(read));
      this.#emitComment(read.position.utf16Offset);
      return this.#emitEof(read.position);
    }
    if (read.value === "-") {
      this.#state = "comment-end-state";
    } else {
      this.#requireComment().append("-");
      this.#cursor.reconsumeCurrent();
      this.#state = "comment-state";
    }
    return null;
  }

  #stepCommentEnd(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-comment", decisionSpan(read));
      this.#emitComment(read.position.utf16Offset);
      return this.#emitEof(read.position);
    }
    if (read.value === ">") {
      this.#state = "data-state";
      this.#emitComment(read.span.endUtf16Offset);
    } else if (read.value === "!") {
      this.#state = "comment-end-bang-state";
    } else if (read.value === "-") {
      this.#requireComment().append("-");
    } else {
      this.#requireComment().append("--");
      this.#cursor.reconsumeCurrent();
      this.#state = "comment-state";
    }
    return null;
  }

  #stepCommentEndBang(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-comment", decisionSpan(read));
      this.#emitComment(read.position.utf16Offset);
      return this.#emitEof(read.position);
    }
    if (read.value === "-") {
      this.#requireComment().append("--!");
      this.#state = "comment-end-dash-state";
    } else if (read.value === ">") {
      this.#emitParseError("incorrectly-closed-comment", read.span);
      this.#state = "data-state";
      this.#emitComment(read.span.endUtf16Offset);
    } else {
      this.#requireComment().append("--!");
      this.#cursor.reconsumeCurrent();
      this.#state = "comment-state";
    }
    return null;
  }

  #stepDoctype(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-doctype", decisionSpan(read));
      this.#doctype = new DoctypeTokenBuilder(this.#markupStartUtf16Offset);
      this.#doctype.forceQuirks();
      this.#emitDoctype(read.position.utf16Offset);
      return this.#emitEof(read.position);
    }
    if (isAsciiWhitespace(read.value)) {
      this.#state = "before-doctype-name-state";
    } else {
      if (read.value !== ">") this.#emitParseError("missing-whitespace-before-doctype-name", read.span);
      this.#cursor.reconsumeCurrent();
      this.#state = "before-doctype-name-state";
    }
    return null;
  }

  #stepBeforeDoctypeName(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-doctype", decisionSpan(read));
      this.#doctype = new DoctypeTokenBuilder(this.#markupStartUtf16Offset);
      this.#doctype.forceQuirks();
      this.#emitDoctype(read.position.utf16Offset);
      return this.#emitEof(read.position);
    }
    if (isAsciiWhitespace(read.value)) return null;
    this.#doctype = new DoctypeTokenBuilder(this.#markupStartUtf16Offset);
    if (read.value === ">") {
      this.#emitParseError("missing-doctype-name", read.span);
      this.#doctype.forceQuirks();
      this.#state = "data-state";
      this.#emitDoctype(read.span.endUtf16Offset);
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      this.#doctype.startName("\uFFFD");
      this.#state = "doctype-name-state";
    } else {
      this.#doctype.startName(asciiLower(read.value));
      this.#state = "doctype-name-state";
    }
    return null;
  }

  #stepDoctypeName(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-doctype", decisionSpan(read));
      this.#requireDoctype().forceQuirks();
      this.#emitDoctype(read.position.utf16Offset);
      return this.#emitEof(read.position);
    }
    if (isAsciiWhitespace(read.value)) {
      this.#state = "after-doctype-name-state";
    } else if (read.value === ">") {
      this.#state = "data-state";
      this.#emitDoctype(read.span.endUtf16Offset);
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      this.#requireDoctype().appendName("\uFFFD");
    } else {
      this.#requireDoctype().appendName(asciiLower(read.value));
    }
    return null;
  }

  #stepAfterDoctypeName(): StepResult {
    const read = this.#cursor.peekCodeUnit();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      const eof = this.#cursor.consume();
      if (eof.kind !== "eof") throw new Error("Tokenizer invariant violated: expected DOCTYPE EOF");
      this.#emitParseError("eof-in-doctype", decisionSpan(eof));
      this.#requireDoctype().forceQuirks();
      this.#emitDoctype(eof.position.utf16Offset);
      return this.#emitEof(eof.position);
    }
    const value = String.fromCharCode(read.value);
    if (isAsciiWhitespace(value) || read.value === 0x0d) {
      const consumed = this.#cursor.consume();
      if (consumed.kind === "need-more-input") return this.#wait(consumed.position);
      if (consumed.kind !== "character") {
        throw new Error("Tokenizer invariant violated: expected DOCTYPE whitespace");
      }
      return null;
    }
    if (value === ">") {
      const consumed = this.#cursor.consume();
      if (consumed.kind === "need-more-input") return this.#wait(consumed.position);
      if (consumed.kind !== "character") {
        throw new Error("Tokenizer invariant violated: expected DOCTYPE delimiter");
      }
      this.#state = "data-state";
      this.#emitDoctype(consumed.span.endUtf16Offset);
      return null;
    }
    const probe = this.#probeKeywords([
      { value: "PUBLIC", caseInsensitive: true },
      { value: "SYSTEM", caseInsensitive: true }
    ]);
    if (probe.kind === "need-more-input") return this.#wait(probe.position);
    if (probe.kind === "match") {
      this.#consumeAscii(probe.value.length);
      this.#state = probe.value === "PUBLIC"
        ? "after-doctype-public-keyword-state"
        : "after-doctype-system-keyword-state";
      return null;
    }
    const consumed = this.#cursor.consume();
    if (consumed.kind === "need-more-input") return this.#wait(consumed.position);
    if (consumed.kind !== "character") {
      throw new Error("Tokenizer invariant violated: expected invalid DOCTYPE character");
    }
    const character = consumed;
    this.#emitParseError("invalid-character-sequence-after-doctype-name", character.span);
    this.#requireDoctype().forceQuirks();
    this.#cursor.reconsumeCurrent();
    this.#state = "bogus-doctype-state";
    return null;
  }

  #stepAfterDoctypeKeyword(identifier: "public" | "system"): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#doctypeEof(read);
    if (isAsciiWhitespace(read.value)) {
      this.#state = identifier === "public"
        ? "before-doctype-public-identifier-state"
        : "before-doctype-system-identifier-state";
    } else if (read.value === '"' || read.value === "'") {
      this.#emitParseError(
        identifier === "public"
          ? "missing-whitespace-after-doctype-public-keyword"
          : "missing-whitespace-after-doctype-system-keyword",
        read.span
      );
      this.#startDoctypeIdentifier(identifier);
      this.#state = this.#doctypeQuotedState(identifier, read.value);
    } else if (read.value === ">") {
      this.#emitParseError(
        identifier === "public" ? "missing-doctype-public-identifier" : "missing-doctype-system-identifier",
        read.span
      );
      this.#requireDoctype().forceQuirks();
      this.#state = "data-state";
      this.#emitDoctype(read.span.endUtf16Offset);
    } else {
      this.#emitParseError(
        identifier === "public"
          ? "missing-quote-before-doctype-public-identifier"
          : "missing-quote-before-doctype-system-identifier",
        read.span
      );
      this.#requireDoctype().forceQuirks();
      this.#cursor.reconsumeCurrent();
      this.#state = "bogus-doctype-state";
    }
    return null;
  }

  #stepBeforeDoctypeIdentifier(identifier: "public" | "system"): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#doctypeEof(read);
    if (isAsciiWhitespace(read.value)) return null;
    if (read.value === '"' || read.value === "'") {
      this.#startDoctypeIdentifier(identifier);
      this.#state = this.#doctypeQuotedState(identifier, read.value);
    } else if (read.value === ">") {
      this.#emitParseError(
        identifier === "public" ? "missing-doctype-public-identifier" : "missing-doctype-system-identifier",
        read.span
      );
      this.#requireDoctype().forceQuirks();
      this.#state = "data-state";
      this.#emitDoctype(read.span.endUtf16Offset);
    } else {
      this.#emitParseError(
        identifier === "public"
          ? "missing-quote-before-doctype-public-identifier"
          : "missing-quote-before-doctype-system-identifier",
        read.span
      );
      this.#requireDoctype().forceQuirks();
      this.#cursor.reconsumeCurrent();
      this.#state = "bogus-doctype-state";
    }
    return null;
  }

  #stepDoctypeIdentifier(identifier: "public" | "system", quote: '"' | "'"): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#doctypeEof(read);
    if (read.value === quote) {
      this.#state = identifier === "public"
        ? "after-doctype-public-identifier-state"
        : "after-doctype-system-identifier-state";
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      this.#appendDoctypeIdentifier(identifier, "\uFFFD");
    } else if (read.value === ">") {
      this.#emitParseError(
        identifier === "public" ? "abrupt-doctype-public-identifier" : "abrupt-doctype-system-identifier",
        read.span
      );
      this.#requireDoctype().forceQuirks();
      this.#state = "data-state";
      this.#emitDoctype(read.span.endUtf16Offset);
    } else {
      this.#appendDoctypeIdentifier(identifier, read.value);
    }
    return null;
  }

  #stepAfterDoctypePublicIdentifier(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#doctypeEof(read);
    if (isAsciiWhitespace(read.value)) {
      this.#state = "between-doctype-public-and-system-identifiers-state";
    } else if (read.value === ">") {
      this.#state = "data-state";
      this.#emitDoctype(read.span.endUtf16Offset);
    } else if (read.value === '"' || read.value === "'") {
      this.#emitParseError("missing-whitespace-between-doctype-public-and-system-identifiers", read.span);
      this.#requireDoctype().startSystemIdentifier();
      this.#state = this.#doctypeQuotedState("system", read.value);
    } else {
      this.#emitParseError("missing-quote-before-doctype-system-identifier", read.span);
      this.#requireDoctype().forceQuirks();
      this.#cursor.reconsumeCurrent();
      this.#state = "bogus-doctype-state";
    }
    return null;
  }

  #stepBetweenDoctypeIdentifiers(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#doctypeEof(read);
    if (isAsciiWhitespace(read.value)) return null;
    if (read.value === ">") {
      this.#state = "data-state";
      this.#emitDoctype(read.span.endUtf16Offset);
    } else if (read.value === '"' || read.value === "'") {
      this.#requireDoctype().startSystemIdentifier();
      this.#state = this.#doctypeQuotedState("system", read.value);
    } else {
      this.#emitParseError("missing-quote-before-doctype-system-identifier", read.span);
      this.#requireDoctype().forceQuirks();
      this.#cursor.reconsumeCurrent();
      this.#state = "bogus-doctype-state";
    }
    return null;
  }

  #stepAfterDoctypeSystemIdentifier(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#doctypeEof(read);
    if (isAsciiWhitespace(read.value)) return null;
    if (read.value === ">") {
      this.#state = "data-state";
      this.#emitDoctype(read.span.endUtf16Offset);
    } else {
      this.#emitParseError("unexpected-character-after-doctype-system-identifier", read.span);
      this.#cursor.reconsumeCurrent();
      this.#state = "bogus-doctype-state";
    }
    return null;
  }

  #stepBogusDoctype(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitDoctype(read.position.utf16Offset);
      return this.#emitEof(read.position);
    }
    if (read.value === ">") {
      this.#state = "data-state";
      this.#emitDoctype(read.span.endUtf16Offset);
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
    }
    return null;
  }

  #stepCharacterReference(): StepResult {
    const consumer = this.#characterReference;
    const returnContext = this.#characterReferenceReturn;
    if (consumer === null || returnContext === null) {
      throw new Error("Tokenizer invariant violated: character-reference state is incomplete");
    }
    const result = consumer.step();
    if (result.kind === "need-more-input") return this.#wait(result.position);
    if (returnContext.context === "attribute") {
      this.#requireTag().appendAttributeValue(result.value, result.span);
    } else {
      this.#appendCharacters(result.value, result.span);
    }
    this.#characterReference = null;
    this.#characterReferenceReturn = null;
    this.#state = returnContext.state;
    return null;
  }

  #startCharacterReference(read: InputCharacter, returnContext: CharacterReferenceReturn): void {
    let additionalAllowedCharacter: string | null = null;
    if (returnContext.state === "attribute-value-(double-quoted)-state") additionalAllowedCharacter = '"';
    if (returnContext.state === "attribute-value-(single-quoted)-state") additionalAllowedCharacter = "'";
    if (returnContext.state === "attribute-value-(unquoted)-state") additionalAllowedCharacter = ">";
    this.#characterReferenceReturn = returnContext;
    this.#characterReference = new CharacterReferenceConsumer(this.#cursor, this.#guard, {
      context: returnContext.context,
      ampersandSpan: read.span,
      additionalAllowedCharacter,
      onParseError: (error) => {
        this.#observeParseError(error);
      }
    });
    this.#state = "character-reference-state";
  }

  #emitTag(decision: SourceSpan): void {
    const builder = this.#requireTag();
    const token = builder.toToken(decision.endUtf16Offset);
    this.#tag = null;
    if (token.kind === "end-tag") {
      if (token.attributes.length > 0) this.#emitParseError("end-tag-with-attributes", decision);
      if (token.selfClosing) this.#emitParseError("end-tag-with-trailing-solidus", decision);
    } else {
      this.#lastStartTagName = token.name;
    }
    const acceptance = this.#emitToken(token);
    if (token.kind === "start-tag" && token.selfClosing && !acceptance.selfClosingAcknowledged) {
      this.#emitParseError("non-void-html-element-start-tag-with-trailing-solidus", decision);
    }
  }

  #emitComment(endUtf16Offset: number): void {
    const token = this.#requireComment().toToken(endUtf16Offset);
    this.#comment = null;
    this.#emitToken(token);
  }

  #emitDoctype(endUtf16Offset: number): void {
    const token = this.#requireDoctype().toToken(endUtf16Offset);
    this.#doctype = null;
    this.#emitToken(token);
  }

  #emitEof(position: SourcePosition): HtmlTokenizerDone {
    if (this.#done) return Object.freeze({ status: "done", position });
    const token = Object.freeze({
      kind: "eof",
      span: sourceSpan(position.utf16Offset, position.utf16Offset)
    } as const);
    this.#emitToken(token);
    this.#done = true;
    return Object.freeze({ status: "done", position });
  }

  #emitToken(token: HtmlToken): { readonly selfClosingAcknowledged: boolean } {
    this.#flushCharacters();
    return this.#deliverToken(token);
  }

  #deliverToken(token: HtmlToken): { readonly selfClosingAcknowledged: boolean } {
    this.#observer?.onToken?.(token);
    this.#guard.ensureActive();
    const acceptance: unknown = this.#sink.accept(token);
    this.#guard.ensureActive();
    if (
      typeof acceptance !== "object" ||
      acceptance === null ||
      Array.isArray(acceptance) ||
      typeof (acceptance as { readonly selfClosingAcknowledged?: unknown }).selfClosingAcknowledged !== "boolean"
    ) {
      throw new EngineConfigurationError(
        "token sink acceptance",
        "must provide a boolean selfClosingAcknowledged value"
      );
    }
    return acceptance as { readonly selfClosingAcknowledged: boolean };
  }

  #appendCharacters(value: string, span: SourceSpan): void {
    if (value.length === 0) return;
    if (
      this.#characterStartUtf16Offset !== null &&
      this.#characterEndUtf16Offset !== span.startUtf16Offset
    ) {
      this.#flushCharacters();
    }
    if (this.#characterStartUtf16Offset === null) {
      this.#characterStartUtf16Offset = span.startUtf16Offset;
    }
    this.#characterEndUtf16Offset = span.endUtf16Offset;
    this.#characterParts.push(value);
  }

  #flushCharacters(): void {
    if (this.#characterStartUtf16Offset === null || this.#characterEndUtf16Offset === null) return;
    const token = Object.freeze({
      kind: "character",
      data: this.#characterParts.join(""),
      span: sourceSpan(this.#characterStartUtf16Offset, this.#characterEndUtf16Offset)
    } as const);
    this.#characterParts = [];
    this.#characterStartUtf16Offset = null;
    this.#characterEndUtf16Offset = null;
    this.#deliverToken(token);
  }

  #finishAttributeName(span: SourceSpan): void {
    if (this.#requireTag().finishAttributeName()) {
      this.#emitParseError("duplicate-attribute", span);
    }
  }

  #emitParseError(code: HtmlParseErrorCode, span: SourceSpan): void {
    this.#guard.reserveParseError();
    this.#observeParseError(createParseError(code, "tokenizer", span));
  }

  #observeParseError(error: EngineParseError): void {
    this.#observer?.onParseError?.(error);
    this.#guard.ensureActive();
  }

  #wait(position: SourcePosition): HtmlTokenizerNeedMore {
    return Object.freeze({ status: "need-more-input", position, state: this.#state });
  }

  #probeKeywords(
    candidates: readonly { readonly value: string; readonly caseInsensitive: boolean }[]
  ): KeywordProbe {
    let waitingPosition: SourcePosition | null = null;
    for (const candidate of candidates) {
      let matches = true;
      for (let index = 0; index < candidate.value.length; index += 1) {
        const read = this.#cursor.peekCodeUnit(index);
        if (read.kind === "need-more-input") {
          waitingPosition = read.position;
          matches = false;
          break;
        }
        if (read.kind === "eof") {
          matches = false;
          break;
        }
        const actual = String.fromCharCode(read.value);
        const expected = candidate.value.charAt(index);
        if (
          candidate.caseInsensitive
            ? asciiLower(actual) !== asciiLower(expected)
            : actual !== expected
        ) {
          matches = false;
          break;
        }
      }
      if (matches) return Object.freeze({ kind: "match", value: candidate.value });
    }
    return waitingPosition === null
      ? Object.freeze({ kind: "no-match" })
      : Object.freeze({ kind: "need-more-input", position: waitingPosition });
  }

  #consumeAscii(count: number): void {
    for (let index = 0; index < count; index += 1) this.#consumeOneCharacter();
  }

  #consumeOneCharacter(): InputCharacter {
    const read: InputRead = this.#cursor.consume();
    if (read.kind !== "character") {
      throw new Error("Tokenizer invariant violated: expected buffered character");
    }
    return read;
  }

  #doctypeEof(read: InputEof): StepResult {
    this.#emitParseError("eof-in-doctype", decisionSpan(read));
    this.#requireDoctype().forceQuirks();
    this.#emitDoctype(read.position.utf16Offset);
    return this.#emitEof(read.position);
  }

  #startDoctypeIdentifier(identifier: "public" | "system"): void {
    if (identifier === "public") this.#requireDoctype().startPublicIdentifier();
    else this.#requireDoctype().startSystemIdentifier();
  }

  #appendDoctypeIdentifier(identifier: "public" | "system", value: string): void {
    if (identifier === "public") this.#requireDoctype().appendPublicIdentifier(value);
    else this.#requireDoctype().appendSystemIdentifier(value);
  }

  #doctypeQuotedState(identifier: "public" | "system", quote: '"' | "'"): HtmlTokenizerState {
    if (identifier === "public") {
      return quote === '"'
        ? "doctype-public-identifier-(double-quoted)-state"
        : "doctype-public-identifier-(single-quoted)-state";
    }
    return quote === '"'
      ? "doctype-system-identifier-(double-quoted)-state"
      : "doctype-system-identifier-(single-quoted)-state";
  }

  #requireTag(): TagTokenBuilder {
    if (this.#tag === null) throw new Error("Tokenizer invariant violated: current tag is missing");
    return this.#tag;
  }

  #requireComment(): CommentTokenBuilder {
    if (this.#comment === null) throw new Error("Tokenizer invariant violated: current comment is missing");
    return this.#comment;
  }

  #requireDoctype(): DoctypeTokenBuilder {
    if (this.#doctype === null) throw new Error("Tokenizer invariant violated: current DOCTYPE is missing");
    return this.#doctype;
  }

  #ensureUsable(): void {
    if (this.#failed) throw this.#failure;
    if (this.#done) throw new EngineConfigurationError("tokenizer", "cannot be controlled after completion");
  }

  #validateObserver(observer: EngineObserver | undefined): void {
    if (observer === undefined) return;
    const unknownObserver: unknown = observer;
    if (typeof unknownObserver !== "object" || unknownObserver === null || Array.isArray(unknownObserver)) {
      throw new EngineConfigurationError("tokenizer observer", "must be an object");
    }
    const record = unknownObserver as Readonly<Record<PropertyKey, unknown>>;
    const allowed = new Set<PropertyKey>([
      "onToken",
      "onParseError",
      "onInsertionModeTransition",
      "onTreeMutation"
    ]);
    for (const key of Reflect.ownKeys(record)) {
      if (!allowed.has(key)) {
        throw new EngineConfigurationError(`tokenizer observer.${String(key)}`, "is not supported");
      }
    }
    for (const key of allowed) {
      const callback = record[key];
      if (callback !== undefined && typeof callback !== "function") {
        throw new EngineConfigurationError(`tokenizer observer.${String(key)}`, "must be a function");
      }
    }
  }
}
