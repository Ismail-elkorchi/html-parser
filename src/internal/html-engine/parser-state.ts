/**
 * Tokenizer modes selected synchronously by tree construction.
 * @see https://html.spec.whatwg.org/multipage/parsing.html#tokenization
 */
export const TOKENIZER_MODES = Object.freeze([
  "data",
  "rcdata",
  "rawtext",
  "script-data",
  "plaintext"
] as const);

export type TokenizerMode = (typeof TOKENIZER_MODES)[number];

/**
 * Tree-construction insertion modes in the pinned HTML Standard.
 * @see https://html.spec.whatwg.org/multipage/parsing.html#the-insertion-mode
 */
export const INSERTION_MODES = Object.freeze([
  "initial",
  "before-html",
  "before-head",
  "in-head",
  "in-head-noscript",
  "after-head",
  "in-body",
  "text",
  "in-table",
  "in-table-text",
  "in-caption",
  "in-column-group",
  "in-table-body",
  "in-row",
  "in-cell",
  "in-template",
  "after-body",
  "in-frameset",
  "after-frameset",
  "after-after-body",
  "after-after-frameset"
] as const);

export type InsertionMode = (typeof INSERTION_MODES)[number];

/** Parser scripting modes in the pinned HTML Standard. */
export const PARSER_SCRIPTING_MODES = Object.freeze([
  "normal",
  "disabled",
  "inert",
  "fragment"
] as const);

export type ParserScriptingMode = (typeof PARSER_SCRIPTING_MODES)[number];

/** Scripting modes supported while the engine does not execute scripts. */
export type NonExecutingScriptingMode = Extract<ParserScriptingMode, "disabled" | "inert">;
