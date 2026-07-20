import type { InsertionMode } from "./parser-state.ts";
import type { SourceSpan } from "./positions.ts";
import type { HtmlToken } from "./tokens.ts";

/**
 * Dedicated parse-error codes in the pinned HTML Standard revision.
 * @see https://html.spec.whatwg.org/multipage/parsing.html#parse-errors
 */
export const HTML_PARSE_ERROR_CODES = Object.freeze([
  "abrupt-closing-of-empty-comment",
  "abrupt-doctype-public-identifier",
  "abrupt-doctype-system-identifier",
  "absence-of-digits-in-numeric-character-reference",
  "cdata-in-html-content",
  "character-reference-outside-unicode-range",
  "control-character-in-input-stream",
  "control-character-reference",
  "disallowed-processing-instruction-target",
  "duplicate-attribute",
  "end-tag-with-attributes",
  "end-tag-with-trailing-solidus",
  "eof-before-tag-name",
  "eof-in-cdata",
  "eof-in-comment",
  "eof-in-doctype",
  "eof-in-processing-instruction",
  "eof-in-script-html-comment-like-text",
  "eof-in-tag",
  "incorrectly-closed-comment",
  "incorrectly-opened-comment",
  "invalid-character-sequence-after-doctype-name",
  "invalid-first-character-of-processing-instruction-target",
  "invalid-first-character-of-tag-name",
  "invalid-processing-instruction-target",
  "missing-attribute-value",
  "missing-doctype-name",
  "missing-doctype-public-identifier",
  "missing-doctype-system-identifier",
  "missing-end-tag-name",
  "missing-quote-before-doctype-public-identifier",
  "missing-quote-before-doctype-system-identifier",
  "missing-semicolon-after-character-reference",
  "missing-whitespace-after-doctype-public-keyword",
  "missing-whitespace-after-doctype-system-keyword",
  "missing-whitespace-before-doctype-name",
  "missing-whitespace-between-attributes",
  "missing-whitespace-between-doctype-public-and-system-identifiers",
  "nested-comment",
  "noncharacter-character-reference",
  "noncharacter-in-input-stream",
  "non-void-html-element-start-tag-with-trailing-solidus",
  "null-character-reference",
  "surrogate-character-reference",
  "surrogate-in-input-stream",
  "unexpected-character-after-doctype-system-identifier",
  "unexpected-character-in-attribute-name",
  "unexpected-character-in-unquoted-attribute-value",
  "unexpected-equals-sign-before-attribute-name",
  "unexpected-null-character",
  "unexpected-solidus-in-tag",
  "unknown-named-character-reference"
] as const);

/** Closed parse-error vocabulary owned by the pinned HTML Standard. */
export type HtmlParseErrorCode = (typeof HTML_PARSE_ERROR_CODES)[number];

/** Engine phase that emitted a non-fatal HTML syntax diagnostic. */
export type ParseErrorPhase = "preprocessing" | "tokenizer" | "tree-builder";

/** Immutable non-fatal HTML syntax diagnostic. */
export interface EngineNamedParseError {
  readonly code: HtmlParseErrorCode;
  readonly phase: Exclude<ParseErrorPhase, "tree-builder">;
  readonly span: SourceSpan;
}

/** The Standard deliberately leaves tree-construction parse errors unnamed. */
export interface EngineTreeBuilderParseError {
  readonly code: "unexpected-token";
  readonly phase: "tree-builder";
  readonly insertionMode: InsertionMode;
  readonly tokenKind: HtmlToken["kind"];
  readonly tagName: string | null;
  readonly span: SourceSpan;
}

export type EngineParseError = EngineNamedParseError | EngineTreeBuilderParseError;

/** Creates an immutable engine parse diagnostic. */
export function createParseError(
  code: HtmlParseErrorCode,
  phase: EngineNamedParseError["phase"],
  span: SourceSpan
): EngineNamedParseError {
  return Object.freeze({ code, phase, span });
}

/** Creates one contextual diagnostic for an unnamed tree-construction parse error. */
export function createTreeBuilderParseError(
  insertionMode: InsertionMode,
  token: HtmlToken
): EngineTreeBuilderParseError {
  return Object.freeze({
    code: "unexpected-token",
    phase: "tree-builder",
    insertionMode,
    tokenKind: token.kind,
    tagName: token.kind === "start-tag" || token.kind === "end-tag" ? token.name : null,
    span: token.span
  });
}
