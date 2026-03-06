/**
 * Deno/JSR entrypoint for deterministic HTML parsing and text extraction.
 *
 * Quickstart:
 * @example
 * ```ts
 * import { parse, visibleText } from "./mod.ts";
 * // Published package form:
 * // import { parse, visibleText } from "jsr:@ismail-elkorchi/html-parser";
 *
 * const tree = parse("<main><h1>Hello</h1><p>World</p></main>");
 * console.log(tree.kind);
 * console.log(visibleText(tree, { trim: true }));
 * ```
 *
 * Additional docs:
 * - `./docs/index.md`
 * - `./docs/reference/options.md`
 */
import {
  parse as parseInternal,
  parseBytes as parseBytesInternal,
  parseFragment as parseFragmentInternal,
  parseStream as parseStreamInternal,
  serialize as serializeInternal,
  tokenizeStream as tokenizeStreamInternal,
  visibleText as visibleTextInternal
} from "../src/public/mod.ts";

/**
 * Parse budget controls for bounding CPU/memory usage.
 */
export interface ParseBudgets {
  /** Maximum input bytes accepted for one parse call. */
  readonly maxInputBytes?: number;
  /** Maximum buffered bytes while decoding a stream. */
  readonly maxBufferedBytes?: number;
  /** Maximum node count emitted by parsing. */
  readonly maxNodes?: number;
  /** Maximum tree depth emitted by parsing. */
  readonly maxDepth?: number;
  /** Maximum trace event count. */
  readonly maxTraceEvents?: number;
  /** Maximum serialized trace size in bytes. */
  readonly maxTraceBytes?: number;
  /** Maximum parse/decode elapsed time in milliseconds. */
  readonly maxTimeMs?: number;
}

/**
 * Options accepted by parse entrypoints.
 */
export interface ParseOptions {
  /** Include source span offsets on nodes and attributes. */
  readonly captureSpans?: boolean;
  /** Backward-compatible alias for `captureSpans`. */
  readonly includeSpans?: boolean;
  /** Emit structured parser trace events. */
  readonly trace?: boolean;
  /** Optional transport encoding hint for byte parsing. */
  readonly transportEncodingLabel?: string;
  /** Optional budget controls for parse/decode operations. */
  readonly budgets?: ParseBudgets;
}

/**
 * Options accepted by stream tokenization.
 */
export interface TokenizeStreamOptions {
  /** Optional transport encoding hint for stream decoding. */
  readonly transportEncodingLabel?: string;
  /** Optional budget controls for stream tokenization. */
  readonly budgets?: ParseBudgets;
}

/**
 * Options accepted by visible text extraction.
 */
export interface VisibleTextOptions {
  /** Skip hidden or non-visible subtrees. */
  readonly skipHiddenSubtrees?: boolean;
  /** Include values from control-like nodes such as inputs. */
  readonly includeControlValues?: boolean;
  /** Include limited accessibility-name fallback sources. */
  readonly includeAccessibleNameFallback?: boolean;
  /** Trim final output text. */
  readonly trim?: boolean;
}

/**
 * Structured parse diagnostic emitted for non-fatal and fatal errors.
 */
export interface ParseError {
  /** Stable parse error category. */
  readonly code:
    | "BUDGET_EXCEEDED"
    | "STREAM_READ_FAILED"
    | "UNSUPPORTED_ENCODING"
    | "INVALID_FRAGMENT_CONTEXT"
    | "PARSER_ERROR";
  /** Deterministic WHATWG parse-error identifier. */
  readonly parseErrorId: string;
  /** Human-readable failure message. */
  readonly message: string;
  /** Optional node id associated with the diagnostic. */
  readonly nodeId?: number;
  /** Optional input offsets associated with the diagnostic. */
  readonly span?: {
    /** Zero-based inclusive start offset. */
    readonly start: number;
    /** Zero-based exclusive end offset. */
    readonly end: number;
  };
}

/**
 * Minimal public node shape used across parse and serialization APIs.
 */
export interface HtmlNode {
  /** Stable node id in the parsed tree. */
  readonly id: number;
  /** Node category. */
  readonly kind: "element" | "text" | "comment" | "doctype";
  /** Element tag name when `kind` is `"element"`. */
  readonly tagName?: string;
  /** Text payload for text/comment nodes. */
  readonly value?: string;
  /** Child nodes when this node can contain descendants. */
  readonly children?: readonly HtmlNode[];
}

/**
 * Parsed HTML document tree returned by `parse`, `parseBytes`, and `parseStream`.
 */
export interface DocumentTree {
  /** Stable document node id. */
  readonly id: number;
  /** Discriminator for full-document parse results. */
  readonly kind: "document";
  /** Top-level parsed nodes in source order. */
  readonly children: readonly HtmlNode[];
  /** Structured parse diagnostics associated with this parse result. */
  readonly errors: readonly ParseError[];
}

/**
 * Parsed HTML fragment tree returned by `parseFragment`.
 */
export interface FragmentTree {
  /** Stable fragment node id. */
  readonly id: number;
  /** Discriminator for fragment parse results. */
  readonly kind: "fragment";
  /** Context element tag used for fragment parsing rules. */
  readonly contextTagName: string;
  /** Fragment child nodes in source order. */
  readonly children: readonly HtmlNode[];
  /** Structured parse diagnostics associated with this parse result. */
  readonly errors: readonly ParseError[];
}

/**
 * Input accepted by `serialize`.
 */
export type SerializableHtml = DocumentTree | FragmentTree | HtmlNode;

/**
 * Input accepted by `visibleText`.
 */
export type VisibleTextInput = DocumentTree | FragmentTree | HtmlNode;

/**
 * Token emitted by `tokenizeStream`.
 */
export interface HtmlToken {
  /** Token category produced by the streaming tokenizer. */
  readonly kind: "startTag" | "endTag" | "chars" | "comment" | "doctype" | "eof";
  /** Tag or doctype name for name-bearing tokens. */
  readonly name?: string;
  /** Text payload for character and comment tokens. */
  readonly value?: string;
  /** Start-tag attributes for `startTag` tokens. */
  readonly attributes?: readonly Readonly<{ readonly name: string; readonly value: string }>[];
  /** Start-tag flag for self-closing tags. */
  readonly selfClosing?: boolean;
  /** Doctype public id, when present. */
  readonly publicId?: string | null;
  /** Doctype system id, when present. */
  readonly systemId?: string | null;
  /** Doctype quirks-mode flag. */
  readonly forceQuirks?: boolean;
}

/**
 * Parses full HTML input into a deterministic document tree.
 *
 * @param input HTML source text to parse.
 * @param options Parse controls for spans, tracing, and resource budgets.
 * @returns Parsed `DocumentTree` with nodes and non-fatal parse diagnostics.
 * @throws {Error} When parsing fails fatally or configured budgets are exceeded.
 *
 * Security and limits:
 * - Use strict `budgets` for untrusted input.
 * - Parsing is structural analysis, not sanitization.
 *
 * @example
 * ```ts
 * import { parse } from "./mod.ts";
 *
 * const tree = parse("<article><h1>News</h1><p>Stable output</p></article>", {
 *   budgets: { maxInputBytes: 8_192, maxNodes: 512, maxDepth: 64 }
 * });
 *
 * console.log(tree.kind);
 * console.log(tree.children.length);
 * ```
 */
export function parse(input: string, options: ParseOptions = {}): DocumentTree {
  return parseInternal(input, options as Parameters<typeof parseInternal>[1]);
}

/**
 * Parses byte-oriented HTML input with encoding sniffing.
 *
 * @param input UTF-8 or legacy-encoded bytes.
 * @param options Parse controls for encoding hints, tracing, and budgets.
 * @returns Parsed `DocumentTree` for decoded HTML input.
 * @throws {Error} When decoding/parsing fails or configured budgets are exceeded.
 */
export function parseBytes(input: Uint8Array, options: ParseOptions = {}): DocumentTree {
  return parseBytesInternal(input, options as Parameters<typeof parseBytesInternal>[1]);
}

/**
 * Parses markup relative to a fragment context element.
 *
 * @param html Fragment HTML source text.
 * @param contextTagName Context element tag name (for example `"template"` or `"table"`).
 * Use the real embedding element so recovery behavior matches browser fragment parsing.
 * @param options Parse controls for tracing and budgets.
 * @returns Parsed `FragmentTree` scoped to the requested context with non-fatal diagnostics.
 * @throws {Error} When context is invalid, parsing fails, or budgets are exceeded.
 *
 * @example
 * ```ts
 * import { parseFragment } from "./mod.ts";
 *
 * const fragment = parseFragment("<li>a</li><li>b</li>", "ul");
 * console.log(fragment.kind);
 * console.log(fragment.children.length);
 * ```
 */
export function parseFragment(
  html: string,
  contextTagName: string,
  options: ParseOptions = {}
): FragmentTree {
  return parseFragmentInternal(
    html,
    contextTagName,
    options as Parameters<typeof parseFragmentInternal>[2]
  );
}

/**
 * Parses HTML bytes from a readable stream.
 *
 * @param input Stream of HTML bytes.
 * @param options Parse controls including stream budget limits.
 * `budgets.maxBufferedBytes` is the main guard for untrusted stream decoding.
 * @returns Promise resolving to parsed `DocumentTree` with accumulated parse diagnostics.
 * @throws {Error} When stream reading/decoding/parsing fails or budgets are exceeded.
 *
 * @example
 * ```ts
 * import { parseStream } from "./mod.ts";
 *
 * const stream = new ReadableStream({
 *   start(controller) {
 *     controller.enqueue(new TextEncoder().encode("<main><p>"));
 *     controller.enqueue(new TextEncoder().encode("streamed"));
 *     controller.enqueue(new TextEncoder().encode("</p></main>"));
 *     controller.close();
 *   }
 * });
 *
 * const tree = await parseStream(stream, {
 *   budgets: { maxInputBytes: 8_192, maxBufferedBytes: 1_024, maxNodes: 512 }
 * });
 *
 * console.log(tree.kind);
 * ```
 */
export async function parseStream(
  input: ReadableStream<Uint8Array>,
  options: ParseOptions = {}
): Promise<DocumentTree> {
  return parseStreamInternal(input, options as Parameters<typeof parseStreamInternal>[1]);
}

/**
 * Serializes a parsed document, fragment, or node back to HTML text.
 *
 * @param input Parsed tree or node.
 * @returns Deterministic HTML serialization output.
 */
export function serialize(input: SerializableHtml): string {
  return serializeInternal(input as Parameters<typeof serializeInternal>[0]);
}

/**
 * Extracts visible text from a parsed tree or node.
 *
 * @param input Parsed document, fragment, or node.
 * @param options Visible-text extraction controls. Hidden-subtree skipping is
 * enabled by default; broaden extraction only when you explicitly need more source text.
 * @returns Stable text output suitable for indexing and plain-text auditing.
 *
 * Failure mode:
 * - This function does not sanitize HTML; it only returns text.
 *
 * @example
 * ```ts
 * import { parse, visibleText } from "./mod.ts";
 *
 * const tree = parse("<main><h1>Hello</h1><p>World</p></main>");
 * console.log(visibleText(tree, { trim: true }));
 * ```
 */
export function visibleText(input: VisibleTextInput, options: VisibleTextOptions = {}): string {
  return visibleTextInternal(
    input as Parameters<typeof visibleTextInternal>[0],
    options as Parameters<typeof visibleTextInternal>[1]
  );
}

/**
 * Tokenizes HTML bytes from a readable stream.
 *
 * @param input Stream of HTML bytes.
 * @param options Stream tokenization controls and budgets.
 * @returns Async iterator yielding parser-compatible HTML tokens in source order.
 * @throws {Error} When stream reading/decoding/tokenization fails or budgets are exceeded.
 */
export async function* tokenizeStream(
  input: ReadableStream<Uint8Array>,
  options: TokenizeStreamOptions = {}
): AsyncIterableIterator<HtmlToken> {
  for await (const token of tokenizeStreamInternal(
    input,
    options as Parameters<typeof tokenizeStreamInternal>[1]
  )) {
    yield token;
  }
}
