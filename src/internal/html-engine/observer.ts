import type { EngineParseError } from "./diagnostics.js";
import type { InsertionMode, TokenizerMode } from "./parser-state.js";
import type { SourceSpan } from "./positions.js";
import type { HtmlToken } from "./tokens.js";

/** Result of immediate tree-builder handling for one emitted token. */
export interface TokenAcceptance {
  readonly selfClosingAcknowledged: boolean;
}

/** Synchronous tokenizer-to-tree-builder delivery boundary. */
export interface TokenSink {
  accept(token: HtmlToken): TokenAcceptance;
}

/** Narrow tree-builder feedback channel into tokenizer state. */
export interface TokenizerControl {
  setMode(mode: TokenizerMode): void;
  setLastStartTagName(name: string | null): void;
  setForeignContent(enabled: boolean): void;
}

/** Token context attached to an insertion-mode transition. */
export interface InsertionModeTokenContext {
  readonly kind: HtmlToken["kind"];
  readonly tagName: string | null;
  readonly span: SourceSpan;
}

/** One synchronous insertion-mode transition. */
export interface InsertionModeTransition {
  readonly from: InsertionMode;
  readonly to: InsertionMode;
  readonly token: InsertionModeTokenContext;
}

/** Mutation categories exposed to internal deterministic observation. */
export type TreeMutationKind =
  | "node-created"
  | "node-inserted"
  | "node-detached"
  | "attributes-adopted"
  | "text-coalesced";

/** Minimal tree-mutation identity independent of the eventual node representation. */
export interface TreeMutationObservation {
  readonly kind: TreeMutationKind;
  readonly node: number;
  readonly parent: number | null;
}

/** Optional synchronous observation hooks for one engine operation. */
export interface EngineObserver {
  readonly onToken?: (token: HtmlToken) => void;
  readonly onParseError?: (error: EngineParseError) => void;
  readonly onInsertionModeTransition?: (transition: InsertionModeTransition) => void;
  readonly onTreeMutation?: (mutation: TreeMutationObservation) => void;
}
