/**
 * Portable HTML parsing, traversal, source editing, and bounded text extraction.
 *
 * This JSR entrypoint re-exports the same runtime and TypeScript contract as
 * the npm/Node entrypoint; public declarations have one canonical owner in
 * `src`.
 *
 * @example Parse a document and extract bounded visible text.
 * ```ts
 * import { extractText, parse } from "./mod.ts";
 * // Published package form:
 * // import { extractText, parse } from "jsr:@ismail-elkorchi/html-parser";
 *
 * const document = parse("<main><h1>Hello</h1><p>World</p></main>");
 * const result = extractText(document.tree, {
 *   policy: "visible-text-html-v1",
 *   maxOutputBytes: 16_384,
 *   maxTokens: 1_024,
 *   maxFallbackInputBytes: 16_384,
 *   maxFallbackNodes: 1_024
 * });
 * console.log(result.text);
 * ```
 *
 * @module
 */
export * from "../src/mod.ts";
