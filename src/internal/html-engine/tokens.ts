import type { SourceSpan } from "./positions.ts";

/** Ordered attribute data retained while a tag token is active. */
export interface HtmlTokenAttribute {
  readonly name: string;
  readonly value: string;
  readonly span: SourceSpan;
  readonly nameSpan: SourceSpan;
  readonly valueSpan: SourceSpan | null;
}

interface HtmlTagTokenBase {
  readonly name: string;
  readonly attributes: readonly HtmlTokenAttribute[];
  readonly selfClosing: boolean;
  readonly span: SourceSpan;
}

/** HTML start-tag token. */
export interface HtmlStartTagToken extends HtmlTagTokenBase {
  readonly kind: "start-tag";
}

/** HTML end-tag token, retaining attributes and trailing-solidus state for diagnostics. */
export interface HtmlEndTagToken extends HtmlTagTokenBase {
  readonly kind: "end-tag";
}

/** HTML DOCTYPE token; null identifiers are distinct from explicit empty strings. */
export interface HtmlDoctypeToken {
  readonly kind: "doctype";
  readonly name: string | null;
  readonly publicIdentifier: string | null;
  readonly systemIdentifier: string | null;
  readonly forceQuirks: boolean;
  readonly span: SourceSpan;
}

/** HTML comment token. */
export interface HtmlCommentToken {
  readonly kind: "comment";
  readonly data: string;
  readonly span: SourceSpan;
}

/** HTML processing-instruction token retained by the pinned standard. */
export interface HtmlProcessingInstructionToken {
  readonly kind: "processing-instruction";
  readonly target: string;
  readonly data: string;
  readonly span: SourceSpan;
}

/** HTML character token. */
export interface HtmlCharacterToken {
  readonly kind: "character";
  readonly data: string;
  readonly span: SourceSpan;
}

/** Conceptual end-of-file token. */
export interface HtmlEofToken {
  readonly kind: "eof";
  readonly span: SourceSpan;
}

/** Exhaustive immutable token union emitted by the independent tokenizer. */
export type HtmlToken =
  | HtmlDoctypeToken
  | HtmlStartTagToken
  | HtmlEndTagToken
  | HtmlCommentToken
  | HtmlProcessingInstructionToken
  | HtmlCharacterToken
  | HtmlEofToken;
