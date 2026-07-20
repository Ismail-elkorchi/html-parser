/**
 * Tokenizer modes selected synchronously by tree construction.
 * @see https://html.spec.whatwg.org/multipage/parsing.html#tokenization
 */
export type TokenizerMode = "data" | "rcdata" | "rawtext" | "script-data" | "plaintext";

/**
 * Tree-construction insertion modes in the pinned HTML Standard.
 * @see https://html.spec.whatwg.org/multipage/parsing.html#the-insertion-mode
 */
export type InsertionMode =
  | "initial"
  | "before-html"
  | "before-head"
  | "in-head"
  | "in-head-noscript"
  | "after-head"
  | "in-body"
  | "text"
  | "in-table"
  | "in-table-text"
  | "in-caption"
  | "in-column-group"
  | "in-table-body"
  | "in-row"
  | "in-cell"
  | "in-template"
  | "after-body"
  | "in-frameset"
  | "after-frameset"
  | "after-after-body"
  | "after-after-frameset";

/** Parser scripting modes in the pinned HTML Standard. */
type ParserScriptingMode = "normal" | "disabled" | "inert" | "fragment";

/** Scripting modes supported while the engine does not execute scripts. */
export type NonExecutingScriptingMode = Extract<ParserScriptingMode, "disabled" | "inert">;
