import {
  failInternalState,
  requireInternalValue,
  unreachableInternalState
} from "../../foundation/internal-state-error.js";
import { CharacterReferenceConsumer } from "../character-reference-consumer.js";
import { createParseError, type EngineParseError, type HtmlParseErrorCode } from "../diagnostics.js";
import {
  HtmlInputCursor,
  type InputCharacter,
  type InputEof,
  type InputNeedMore,
  type InputRead
} from "../input-cursor.js";
import { type EngineObserver, type TokenSink, type TokenizerControl } from "../observer.js";
import { type TokenizerMode } from "../parser-state.js";
import { sourceSpan, type SourcePosition, type SourceSpan } from "../positions.js";
import { EngineConfigurationError, type EngineResourceGuard } from "../resource-guard.js";
import { type HtmlToken } from "../tokens.js";

import {
  CommentTokenBuilder,
  DoctypeTokenBuilder,
  ProcessingInstructionTokenBuilder,
  TagTokenBuilder
} from "./builders.js";
import {
  type HtmlTokenizerExecutionState
} from "./state.js";

/** Tokenization stopped at an open decoded-input boundary. */
export interface HtmlTokenizerNeedMore {
  readonly status: "need-more-input";
  readonly position: SourcePosition;
  readonly state: HtmlTokenizerExecutionState;
}

/** Tokenization emitted its sole end-of-file token. */
export interface HtmlTokenizerDone {
  readonly status: "done";
  readonly position: SourcePosition;
}

export type HtmlTokenizerRunResult = HtmlTokenizerNeedMore | HtmlTokenizerDone;

/** States that a test or future parser driver may select before input begins. */
export type HtmlTokenizerInitialState = TokenizerMode | "cdata-section";

export interface HtmlTokenizerOptions {
  readonly initialState?: HtmlTokenizerInitialState;
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

type CharacterReferenceReturnState = "data-state" | "rcdata-state" | AttributeValueState;

interface ActiveCharacterReference {
  readonly consumer: CharacterReferenceConsumer;
  readonly returnState: CharacterReferenceReturnState;
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

function isAsciiAlphanumeric(value: string): boolean {
  if (value.length !== 1) return false;
  const code = value.charCodeAt(0);
  return isAsciiAlpha(value) || (code >= 0x30 && code <= 0x39);
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

function initialState(value: HtmlTokenizerInitialState): TextState | "cdata-section-state" {
  switch (value) {
    case "data": return "data-state";
    case "rcdata": return "rcdata-state";
    case "rawtext": return "rawtext-state";
    case "script-data": return "script-data-state";
    case "plaintext": return "plaintext-state";
    case "cdata-section": return "cdata-section-state";
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

function validateInitialState(value: unknown): HtmlTokenizerInitialState {
  if (value === "cdata-section") return value;
  return validateMode(value);
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
  #state: HtmlTokenizerExecutionState;
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
  #characterCategory: "ascii-whitespace" | "line-feed" | "null" | "other" | null = null;
  #tag: TagTokenBuilder | null = null;
  #comment: CommentTokenBuilder | null = null;
  #doctype: DoctypeTokenBuilder | null = null;
  #processingInstruction: ProcessingInstructionTokenBuilder | null = null;
  #characterReference: ActiveCharacterReference | null = null;
  #lessThanSpan: SourceSpan | null = null;
  #temporaryBufferParts: string[] = [];
  #cdataBracketStartUtf16Offset: number | null = null;

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
    const allowed = new Set<PropertyKey>(["initialState", "lastStartTagName", "foreignContent", "observer"]);
    for (const key of Reflect.ownKeys(record)) {
      if (!allowed.has(key)) {
        throw new EngineConfigurationError(`tokenizer options.${String(key)}`, "is not supported");
      }
    }
    const entry = validateInitialState(options.initialState ?? "data");
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
    this.#state = initialState(entry);
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
    this.#state = initialState(validateMode(mode));
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

  state(): HtmlTokenizerExecutionState {
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
      case "rcdata-less-than-sign-state": return this.#stepTextLessThan("rcdata");
      case "rcdata-end-tag-open-state": return this.#stepTextEndTagOpen("rcdata");
      case "rcdata-end-tag-name-state": return this.#stepTextEndTagName("rcdata-state");
      case "rawtext-less-than-sign-state": return this.#stepTextLessThan("rawtext");
      case "rawtext-end-tag-open-state": return this.#stepTextEndTagOpen("rawtext");
      case "rawtext-end-tag-name-state": return this.#stepTextEndTagName("rawtext-state");
      case "script-data-less-than-sign-state": return this.#stepScriptDataLessThanSign();
      case "script-data-end-tag-open-state": return this.#stepTextEndTagOpen("script-data");
      case "script-data-end-tag-name-state": return this.#stepTextEndTagName("script-data-state");
      case "script-data-escape-start-state": return this.#stepScriptEscapeStart();
      case "script-data-escape-start-dash-state": return this.#stepScriptEscapeStartDash();
      case "script-data-escaped-state": return this.#stepScriptEscaped();
      case "script-data-escaped-dash-state": return this.#stepScriptEscapedDash();
      case "script-data-escaped-dash-dash-state": return this.#stepScriptEscapedDashDash();
      case "script-data-escaped-less-than-sign-state": return this.#stepScriptEscapedLessThanSign();
      case "script-data-escaped-end-tag-open-state": return this.#stepTextEndTagOpen("script-data-escaped");
      case "script-data-escaped-end-tag-name-state": return this.#stepTextEndTagName("script-data-escaped-state");
      case "script-data-double-escape-start-state": return this.#stepScriptDoubleEscapeStart();
      case "script-data-double-escaped-state": return this.#stepScriptDoubleEscaped();
      case "script-data-double-escaped-dash-state": return this.#stepScriptDoubleEscapedDash();
      case "script-data-double-escaped-dash-dash-state": return this.#stepScriptDoubleEscapedDashDash();
      case "script-data-double-escaped-less-than-sign-state": return this.#stepScriptDoubleEscapedLessThanSign();
      case "script-data-double-escape-end-state": return this.#stepScriptDoubleEscapeEnd();
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
      case "cdata-section-state": return this.#stepCdataSection();
      case "cdata-section-bracket-state": return this.#stepCdataSectionBracket();
      case "cdata-section-end-state": return this.#stepCdataSectionEnd();
      case "processing-instruction-open-state": return this.#stepProcessingInstructionOpen();
      case "processing-instruction-target-state": return this.#stepProcessingInstructionTarget();
      case "after-processing-instruction-target-state": return this.#stepAfterProcessingInstructionTarget();
      case "processing-instruction-data-state": return this.#stepProcessingInstructionData();
      case "processing-instruction-questionable-state": return this.#stepProcessingInstructionQuestionable();
      case "character-reference-state": return this.#stepCharacterReference();
      default: return unreachableInternalState(this.#state, "TOKENIZER_STATE_UNREACHABLE");
    }
  }

  #stepData(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#emitEof(read.position);
    if (read.value === "&") {
      this.#startCharacterReference(read, "data-state");
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
      this.#startCharacterReference(read, "rcdata-state");
    } else if (read.value === "<") {
      this.#lessThanSpan = read.span;
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
      this.#lessThanSpan = read.span;
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

  #stepTextLessThan(family: "rcdata" | "rawtext"): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    const lessThan = this.#requireLessThanSpan();
    if (read.kind === "character" && read.value === "/") {
      this.#markupStartUtf16Offset = lessThan.startUtf16Offset;
      this.#resetTemporaryBuffer();
      this.#state = family === "rcdata"
        ? "rcdata-end-tag-open-state"
        : "rawtext-end-tag-open-state";
    } else {
      this.#appendCharacters("<", lessThan);
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#lessThanSpan = null;
      this.#state = family === "rcdata" ? "rcdata-state" : "rawtext-state";
    }
    return null;
  }

  #stepTextEndTagOpen(
    family: "rcdata" | "rawtext" | "script-data" | "script-data-escaped"
  ): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && isAsciiAlpha(read.value)) {
      this.#tag = new TagTokenBuilder(
        "end-tag",
        this.#requireLessThanSpan().startUtf16Offset,
        this.#guard.beginStartTag()
      );
      this.#cursor.reconsumeCurrent();
      this.#state = this.#textEndTagNameState(family);
    } else {
      const endUtf16Offset = read.kind === "character"
        ? read.span.startUtf16Offset
        : read.position.utf16Offset;
      this.#appendCharacters(
        "</",
        sourceSpan(this.#requireLessThanSpan().startUtf16Offset, endUtf16Offset)
      );
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#lessThanSpan = null;
      this.#resetTemporaryBuffer();
      this.#state = this.#textFamilyState(family);
    }
    return null;
  }

  #stepTextEndTagName(
    fallbackState: "rcdata-state" | "rawtext-state" | "script-data-state" | "script-data-escaped-state"
  ): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && isAsciiAlpha(read.value)) {
      this.#requireTag().appendName(asciiLower(read.value));
      this.#temporaryBufferParts.push(read.value);
      return null;
    }

    const appropriate = this.#isAppropriateEndTag();
    if (read.kind === "character" && appropriate) {
      if (isAsciiWhitespace(read.value)) {
        this.#lessThanSpan = null;
        this.#resetTemporaryBuffer();
        this.#state = "before-attribute-name-state";
        return null;
      }
      if (read.value === "/") {
        this.#lessThanSpan = null;
        this.#resetTemporaryBuffer();
        this.#state = "self-closing-start-tag-state";
        return null;
      }
      if (read.value === ">") {
        this.#lessThanSpan = null;
        this.#resetTemporaryBuffer();
        this.#state = "data-state";
        this.#emitTag(read.span);
        return null;
      }
    }

    const endUtf16Offset = read.kind === "character"
      ? read.span.startUtf16Offset
      : read.position.utf16Offset;
    this.#appendCharacters(
      `</${this.#temporaryBuffer()}`,
      sourceSpan(this.#requireLessThanSpan().startUtf16Offset, endUtf16Offset)
    );
    this.#tag = null;
    this.#lessThanSpan = null;
    this.#resetTemporaryBuffer();
    if (read.kind === "character") this.#cursor.reconsumeCurrent();
    this.#state = fallbackState;
    return null;
  }

  #stepScriptDataLessThanSign(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    const lessThan = this.#requireLessThanSpan();
    if (read.kind === "character" && read.value === "/") {
      this.#markupStartUtf16Offset = lessThan.startUtf16Offset;
      this.#resetTemporaryBuffer();
      this.#state = "script-data-end-tag-open-state";
    } else if (read.kind === "character" && read.value === "!") {
      this.#appendCharacters("<!", sourceSpan(lessThan.startUtf16Offset, read.span.endUtf16Offset));
      this.#lessThanSpan = null;
      this.#state = "script-data-escape-start-state";
    } else {
      this.#appendCharacters("<", lessThan);
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#lessThanSpan = null;
      this.#state = "script-data-state";
    }
    return null;
  }

  #stepScriptEscapeStart(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && read.value === "-") {
      this.#appendCharacters("-", read.span);
      this.#state = "script-data-escape-start-dash-state";
    } else {
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "script-data-state";
    }
    return null;
  }

  #stepScriptEscapeStartDash(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && read.value === "-") {
      this.#appendCharacters("-", read.span);
      this.#state = "script-data-escaped-dash-dash-state";
    } else {
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "script-data-state";
    }
    return null;
  }

  #stepScriptEscaped(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#scriptEscapedEof(read);
    if (read.value === "-") {
      this.#appendCharacters("-", read.span);
      this.#state = "script-data-escaped-dash-state";
    } else if (read.value === "<") {
      this.#lessThanSpan = read.span;
      this.#state = "script-data-escaped-less-than-sign-state";
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      this.#appendCharacters("\uFFFD", read.span);
    } else {
      this.#appendCharacters(read.value, read.span);
    }
    return null;
  }

  #stepScriptEscapedDash(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#scriptEscapedEof(read);
    if (read.value === "-") {
      this.#appendCharacters("-", read.span);
      this.#state = "script-data-escaped-dash-dash-state";
    } else if (read.value === "<") {
      this.#lessThanSpan = read.span;
      this.#state = "script-data-escaped-less-than-sign-state";
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      this.#appendCharacters("\uFFFD", read.span);
      this.#state = "script-data-escaped-state";
    } else {
      this.#appendCharacters(read.value, read.span);
      this.#state = "script-data-escaped-state";
    }
    return null;
  }

  #stepScriptEscapedDashDash(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#scriptEscapedEof(read);
    if (read.value === "-") {
      this.#appendCharacters("-", read.span);
    } else if (read.value === "<") {
      this.#lessThanSpan = read.span;
      this.#state = "script-data-escaped-less-than-sign-state";
    } else if (read.value === ">") {
      this.#appendCharacters(">", read.span);
      this.#state = "script-data-state";
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      this.#appendCharacters("\uFFFD", read.span);
      this.#state = "script-data-escaped-state";
    } else {
      this.#appendCharacters(read.value, read.span);
      this.#state = "script-data-escaped-state";
    }
    return null;
  }

  #stepScriptEscapedLessThanSign(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    const lessThan = this.#requireLessThanSpan();
    if (read.kind === "character" && read.value === "/") {
      this.#markupStartUtf16Offset = lessThan.startUtf16Offset;
      this.#resetTemporaryBuffer();
      this.#state = "script-data-escaped-end-tag-open-state";
    } else if (read.kind === "character" && isAsciiAlpha(read.value)) {
      this.#resetTemporaryBuffer();
      this.#appendCharacters("<", lessThan);
      this.#lessThanSpan = null;
      this.#cursor.reconsumeCurrent();
      this.#state = "script-data-double-escape-start-state";
    } else {
      this.#appendCharacters("<", lessThan);
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#lessThanSpan = null;
      this.#state = "script-data-escaped-state";
    }
    return null;
  }

  #stepScriptDoubleEscapeStart(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && this.#isScriptDoubleEscapeDelimiter(read.value)) {
      this.#state = this.#temporaryBuffer() === "script"
        ? "script-data-double-escaped-state"
        : "script-data-escaped-state";
      this.#appendCharacters(read.value, read.span);
    } else if (read.kind === "character" && isAsciiAlpha(read.value)) {
      this.#temporaryBufferParts.push(asciiLower(read.value));
      this.#appendCharacters(read.value, read.span);
    } else {
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "script-data-escaped-state";
    }
    return null;
  }

  #stepScriptDoubleEscaped(): StepResult {
    return this.#stepScriptDoubleEscapedBody("script-data-double-escaped-state");
  }

  #stepScriptDoubleEscapedDash(): StepResult {
    return this.#stepScriptDoubleEscapedBody("script-data-double-escaped-dash-state");
  }

  #stepScriptDoubleEscapedDashDash(): StepResult {
    return this.#stepScriptDoubleEscapedBody("script-data-double-escaped-dash-dash-state");
  }

  #stepScriptDoubleEscapedBody(
    current:
      | "script-data-double-escaped-state"
      | "script-data-double-escaped-dash-state"
      | "script-data-double-escaped-dash-dash-state"
  ): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") return this.#scriptEscapedEof(read);
    if (read.value === "-") {
      this.#appendCharacters("-", read.span);
      this.#state = current === "script-data-double-escaped-dash-dash-state"
        ? current
        : "script-data-double-escaped-dash-state";
      if (current === "script-data-double-escaped-dash-state") {
        this.#state = "script-data-double-escaped-dash-dash-state";
      }
    } else if (read.value === "<") {
      this.#appendCharacters("<", read.span);
      this.#state = "script-data-double-escaped-less-than-sign-state";
    } else if (read.value === ">" && current === "script-data-double-escaped-dash-dash-state") {
      this.#appendCharacters(">", read.span);
      this.#state = "script-data-state";
    } else if (read.value === "\0") {
      this.#emitParseError("unexpected-null-character", read.span);
      this.#appendCharacters("\uFFFD", read.span);
      this.#state = "script-data-double-escaped-state";
    } else {
      this.#appendCharacters(read.value, read.span);
      this.#state = "script-data-double-escaped-state";
    }
    return null;
  }

  #stepScriptDoubleEscapedLessThanSign(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && read.value === "/") {
      this.#resetTemporaryBuffer();
      this.#appendCharacters("/", read.span);
      this.#state = "script-data-double-escape-end-state";
    } else {
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "script-data-double-escaped-state";
    }
    return null;
  }

  #stepScriptDoubleEscapeEnd(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && this.#isScriptDoubleEscapeDelimiter(read.value)) {
      this.#state = this.#temporaryBuffer() === "script"
        ? "script-data-escaped-state"
        : "script-data-double-escaped-state";
      this.#appendCharacters(read.value, read.span);
    } else if (read.kind === "character" && isAsciiAlpha(read.value)) {
      this.#temporaryBufferParts.push(asciiLower(read.value));
      this.#appendCharacters(read.value, read.span);
    } else {
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "script-data-double-escaped-state";
    }
    return null;
  }

  #scriptEscapedEof(read: InputEof): StepResult {
    this.#emitParseError("eof-in-script-html-comment-like-text", decisionSpan(read));
    return this.#emitEof(read.position);
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
      this.#resetTemporaryBuffer();
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
      this.#startCharacterReference(
        read,
        quote === '"'
          ? "attribute-value-(double-quoted)-state"
          : "attribute-value-(single-quoted)-state"
      );
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
      this.#startCharacterReference(read, "attribute-value-(unquoted)-state");
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
      const eof = this.#consumeLookedAheadEof();
      this.#emitParseError("eof-in-doctype", decisionSpan(eof));
      this.#requireDoctype().forceQuirks();
      this.#emitDoctype(eof.position.utf16Offset);
      return this.#emitEof(eof.position);
    }
    const value = String.fromCharCode(read.value);
    if (isAsciiWhitespace(value) || read.value === 0x0d) {
      const consumed = this.#consumeLookedAheadCharacter();
      if (consumed.kind === "need-more-input") return this.#wait(consumed.position);
      return null;
    }
    if (value === ">") {
      const consumed = this.#consumeLookedAheadCharacter();
      if (consumed.kind === "need-more-input") return this.#wait(consumed.position);
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
    const character = this.#consumeLookedAheadCharacter();
    if (character.kind === "need-more-input") return this.#wait(character.position);
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

  #stepCdataSection(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-cdata", decisionSpan(read));
      return this.#emitEof(read.position);
    }
    if (read.value === "]") {
      this.#cdataBracketStartUtf16Offset = read.span.startUtf16Offset;
      this.#state = "cdata-section-bracket-state";
    } else {
      this.#appendCharacters(read.value, read.span);
    }
    return null;
  }

  #stepCdataSectionBracket(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && read.value === "]") {
      this.#state = "cdata-section-end-state";
    } else {
      const start = this.#requireCdataBracketStart();
      const end = read.kind === "character"
        ? read.span.startUtf16Offset
        : read.position.utf16Offset;
      this.#appendCharacters("]", sourceSpan(start, end));
      this.#cdataBracketStartUtf16Offset = null;
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "cdata-section-state";
    }
    return null;
  }

  #stepCdataSectionEnd(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    const start = this.#requireCdataBracketStart();
    if (read.kind === "character" && read.value === "]") {
      this.#appendCharacters("]", sourceSpan(start, start + 1));
      this.#cdataBracketStartUtf16Offset = start + 1;
    } else if (read.kind === "character" && read.value === ">") {
      this.#cdataBracketStartUtf16Offset = null;
      this.#state = "data-state";
    } else {
      const end = read.kind === "character"
        ? read.span.startUtf16Offset
        : read.position.utf16Offset;
      this.#appendCharacters("]]", sourceSpan(start, end));
      this.#cdataBracketStartUtf16Offset = null;
      if (read.kind === "character") this.#cursor.reconsumeCurrent();
      this.#state = "cdata-section-state";
    }
    return null;
  }

  #stepProcessingInstructionOpen(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-processing-instruction", decisionSpan(read));
      return this.#emitEof(read.position);
    }
    if (isAsciiAlpha(read.value) || read.value === "_") {
      this.#cursor.reconsumeCurrent();
      this.#state = "processing-instruction-target-state";
    } else {
      this.#emitParseError("invalid-first-character-of-processing-instruction-target", read.span);
      this.#convertTemporaryBufferToComment();
      this.#cursor.reconsumeCurrent();
      this.#state = "bogus-comment-state";
    }
    return null;
  }

  #stepProcessingInstructionTarget(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-processing-instruction", decisionSpan(read));
      return this.#emitEof(read.position);
    }
    if (isAsciiWhitespace(read.value) || read.value === "?" || read.value === ">") {
      const target = this.#temporaryBuffer();
      const normalized = target.toLowerCase();
      if (normalized === "xml" || normalized === "xml-stylesheet") {
        this.#emitParseError("disallowed-processing-instruction-target", read.span);
        this.#convertTemporaryBufferToComment();
        this.#cursor.reconsumeCurrent();
        this.#state = "bogus-comment-state";
      } else {
        this.#processingInstruction = new ProcessingInstructionTokenBuilder(
          this.#markupStartUtf16Offset,
          target
        );
        this.#resetTemporaryBuffer();
        this.#cursor.reconsumeCurrent();
        this.#state = "after-processing-instruction-target-state";
      }
    } else if (isAsciiAlphanumeric(read.value) || read.value === "-" || read.value === "_") {
      this.#temporaryBufferParts.push(read.value);
    } else {
      this.#emitParseError("invalid-processing-instruction-target", read.span);
      this.#convertTemporaryBufferToComment();
      this.#cursor.reconsumeCurrent();
      this.#state = "bogus-comment-state";
    }
    return null;
  }

  #stepAfterProcessingInstructionTarget(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "character" && isAsciiWhitespace(read.value)) return null;
    if (read.kind === "character") this.#cursor.reconsumeCurrent();
    this.#state = "processing-instruction-data-state";
    return null;
  }

  #stepProcessingInstructionData(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-processing-instruction", decisionSpan(read));
      this.#processingInstruction = null;
      return this.#emitEof(read.position);
    }
    if (read.value === "?") {
      this.#state = "processing-instruction-questionable-state";
    } else if (read.value === ">") {
      this.#state = "data-state";
      this.#emitProcessingInstruction(read.span.endUtf16Offset);
    } else {
      this.#requireProcessingInstruction().appendData(read.value);
    }
    return null;
  }

  #stepProcessingInstructionQuestionable(): StepResult {
    const read = this.#cursor.consume();
    if (read.kind === "need-more-input") return this.#wait(read.position);
    if (read.kind === "eof") {
      this.#emitParseError("eof-in-processing-instruction", decisionSpan(read));
      this.#processingInstruction = null;
      return this.#emitEof(read.position);
    }
    if (read.value === ">") {
      this.#state = "data-state";
      this.#emitProcessingInstruction(read.span.endUtf16Offset);
    } else {
      this.#requireProcessingInstruction().appendData("?");
      this.#cursor.reconsumeCurrent();
      this.#state = "processing-instruction-data-state";
    }
    return null;
  }

  #stepCharacterReference(): StepResult {
    const active = requireInternalValue(
      this.#characterReference,
      "TOKENIZER_CHARACTER_REFERENCE_MISSING"
    );
    const result = active.consumer.step();
    if (result.kind === "need-more-input") return this.#wait(result.position);
    if (active.returnState !== "data-state" && active.returnState !== "rcdata-state") {
      this.#requireTag().appendAttributeValue(result.value, result.span);
    } else {
      this.#appendCharacters(result.value, result.span);
    }
    this.#characterReference = null;
    this.#state = active.returnState;
    return null;
  }

  #startCharacterReference(read: InputCharacter, returnState: CharacterReferenceReturnState): void {
    let additionalAllowedCharacter: string | null = null;
    if (returnState === "attribute-value-(double-quoted)-state") additionalAllowedCharacter = '"';
    if (returnState === "attribute-value-(single-quoted)-state") additionalAllowedCharacter = "'";
    if (returnState === "attribute-value-(unquoted)-state") additionalAllowedCharacter = ">";
    const context = returnState === "data-state" || returnState === "rcdata-state"
      ? "text"
      : "attribute";
    this.#characterReference = {
      consumer: new CharacterReferenceConsumer(this.#cursor, this.#guard, {
        context,
        ampersandSpan: read.span,
        additionalAllowedCharacter,
        onParseError: (error) => {
          this.#observeParseError(error);
        }
      }),
      returnState
    };
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

  #emitProcessingInstruction(endUtf16Offset: number): void {
    const token = this.#requireProcessingInstruction().toToken(endUtf16Offset);
    this.#processingInstruction = null;
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
    const category = value === "\n"
      ? "line-feed"
      : value === "\u0000" ? "null"
      : /^[\t\f\r ]+$/u.test(value) ? "ascii-whitespace" : "other";
    if (
      this.#characterStartUtf16Offset !== null &&
      (this.#characterEndUtf16Offset !== span.startUtf16Offset ||
        this.#characterCategory !== category)
    ) {
      this.#flushCharacters();
    }
    if (this.#characterStartUtf16Offset === null) {
      this.#characterStartUtf16Offset = span.startUtf16Offset;
      this.#characterCategory = category;
    }
    this.#characterEndUtf16Offset = span.endUtf16Offset;
    this.#characterParts.push(value);
    if (category === "line-feed" || category === "null") this.#flushCharacters();
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
    this.#characterCategory = null;
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
    for (let index = 0; index < count; index += 1) this.#consumeBufferedCharacter();
  }

  #consumeBufferedCharacter(): InputCharacter {
    const read: InputRead = this.#cursor.consume();
    if (read.kind !== "character") {
      return failInternalState("TOKENIZER_BUFFERED_CHARACTER_MISSING");
    }
    return read;
  }

  #consumeLookedAheadCharacter(): InputCharacter | InputNeedMore {
    const read = this.#cursor.consume();
    if (read.kind === "eof") {
      return failInternalState("TOKENIZER_LOOKAHEAD_CONSUMPTION_MISMATCH");
    }
    return read;
  }

  #consumeLookedAheadEof(): InputEof {
    const read = this.#cursor.consume();
    if (read.kind !== "eof") {
      return failInternalState("TOKENIZER_LOOKAHEAD_CONSUMPTION_MISMATCH");
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

  #doctypeQuotedState(
    identifier: "public" | "system",
    quote: '"' | "'"
  ): HtmlTokenizerExecutionState {
    if (identifier === "public") {
      return quote === '"'
        ? "doctype-public-identifier-(double-quoted)-state"
        : "doctype-public-identifier-(single-quoted)-state";
    }
    return quote === '"'
      ? "doctype-system-identifier-(double-quoted)-state"
      : "doctype-system-identifier-(single-quoted)-state";
  }

  #textEndTagNameState(
    family: "rcdata" | "rawtext" | "script-data" | "script-data-escaped"
  ): HtmlTokenizerExecutionState {
    switch (family) {
      case "rcdata": return "rcdata-end-tag-name-state";
      case "rawtext": return "rawtext-end-tag-name-state";
      case "script-data": return "script-data-end-tag-name-state";
      case "script-data-escaped": return "script-data-escaped-end-tag-name-state";
    }
  }

  #textFamilyState(
    family: "rcdata" | "rawtext" | "script-data" | "script-data-escaped"
  ): TextState | "script-data-escaped-state" {
    switch (family) {
      case "rcdata": return "rcdata-state";
      case "rawtext": return "rawtext-state";
      case "script-data": return "script-data-state";
      case "script-data-escaped": return "script-data-escaped-state";
    }
  }

  #isAppropriateEndTag(): boolean {
    return this.#lastStartTagName !== null && this.#requireTag().name() === this.#lastStartTagName;
  }

  #isScriptDoubleEscapeDelimiter(value: string): boolean {
    return isAsciiWhitespace(value) || value === "/" || value === ">";
  }

  #temporaryBuffer(): string {
    return this.#temporaryBufferParts.join("");
  }

  #resetTemporaryBuffer(): void {
    this.#temporaryBufferParts = [];
  }

  #convertTemporaryBufferToComment(): void {
    this.#comment = new CommentTokenBuilder(
      this.#markupStartUtf16Offset,
      `?${this.#temporaryBuffer()}`
    );
    this.#resetTemporaryBuffer();
  }

  #requireLessThanSpan(): SourceSpan {
    return requireInternalValue(this.#lessThanSpan, "TOKENIZER_LESS_THAN_SPAN_MISSING");
  }

  #requireCdataBracketStart(): number {
    return requireInternalValue(
      this.#cdataBracketStartUtf16Offset,
      "TOKENIZER_CDATA_BRACKET_POSITION_MISSING"
    );
  }

  #requireTag(): TagTokenBuilder {
    return requireInternalValue(this.#tag, "TOKENIZER_CURRENT_TAG_MISSING");
  }

  #requireComment(): CommentTokenBuilder {
    return requireInternalValue(this.#comment, "TOKENIZER_CURRENT_COMMENT_MISSING");
  }

  #requireDoctype(): DoctypeTokenBuilder {
    return requireInternalValue(this.#doctype, "TOKENIZER_CURRENT_DOCTYPE_MISSING");
  }

  #requireProcessingInstruction(): ProcessingInstructionTokenBuilder {
    return requireInternalValue(
      this.#processingInstruction,
      "TOKENIZER_CURRENT_PROCESSING_INSTRUCTION_MISSING"
    );
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
