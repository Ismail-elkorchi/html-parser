import type { InsertionMode } from "./parser-state.ts";
import type { SourceSpan } from "./positions.ts";
import type { HtmlToken } from "./tokens.ts";
import type { HtmlParseErrorCode } from "../foundation/parse-error-codes.ts";

export type { HtmlParseErrorCode } from "../foundation/parse-error-codes.ts";

/** Engine phase that emitted a non-fatal HTML syntax diagnostic. */
type ParseErrorPhase = "preprocessing" | "tokenizer" | "tree-builder";

/** Immutable non-fatal HTML syntax diagnostic. */
interface EngineNamedParseError {
  readonly code: HtmlParseErrorCode;
  readonly phase: Exclude<ParseErrorPhase, "tree-builder">;
  readonly span: SourceSpan;
}

/** The Standard deliberately leaves tree-construction parse errors unnamed. */
interface EngineTreeBuilderParseError {
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
