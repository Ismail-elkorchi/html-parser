/**
 * Deno/JSR entrypoint for HTML parsing with visible-text extraction, fragment parsing, and structural traversal.
 *
 * Quickstart:
 * @example
 * ```ts
 * import { parse, visibleText } from "./mod.ts";
 * // Published package form:
 * // import { parse, visibleText } from "jsr:@ismail-elkorchi/html-parser";
 *
 * const document = parse("<main><h1>Hello</h1><p>World</p></main>");
 * console.log(document.tree.kind);
 * console.log(visibleText(document.tree, { trim: true }));
 * ```
 *
 * Additional docs:
 * - `./docs/index.md`
 * - `./docs/reference/options.md`
 */
import {
  findAllByAttr as findAllByAttrInternal,
  findAllByAttrNS as findAllByAttrNSInternal,
  findAllByTagName as findAllByTagNameInternal,
  findAllByTagNameNS as findAllByTagNameNSInternal,
  getAttributeValue as getAttributeValueInternal,
  getAttributeValueNS as getAttributeValueNSInternal,
  hasAttribute as hasAttributeInternal,
  hasAttributeNS as hasAttributeNSInternal,
  HTML_NAMESPACE_URI as HTML_NAMESPACE_URI_INTERNAL,
  MATHML_NAMESPACE_URI as MATHML_NAMESPACE_URI_INTERNAL,
  parse as parseInternal,
  parseBytes as parseBytesInternal,
  parseFragment as parseFragmentInternal,
  parseStream as parseStreamInternal,
  serialize as serializeInternal,
  tokenizeByteStreamEager as tokenizeByteStreamEagerInternal,
  visibleText as visibleTextInternal,
  SVG_NAMESPACE_URI as SVG_NAMESPACE_URI_INTERNAL,
  XLINK_NAMESPACE_URI as XLINK_NAMESPACE_URI_INTERNAL,
  XML_NAMESPACE_URI as XML_NAMESPACE_URI_INTERNAL,
  XMLNS_NAMESPACE_URI as XMLNS_NAMESPACE_URI_INTERNAL
} from "../src/public/mod.ts";
import type {
  TraceEvent,
  TraceEventCallback,
  TraceMode,
  TraceResult,
  TraceSummary
} from "../src/public/types.ts";

export {
  HtmlAbortError,
  HtmlBudgetExceededError,
  HtmlConfigurationError,
  HtmlPatchPlanningError,
  HtmlStreamReadError,
  isHtmlBudgetExceededError,
  isHtmlAbortError,
  isHtmlConfigurationError,
  isHtmlOperationalError,
  isHtmlPatchPlanningError,
  isHtmlStreamReadError
} from "../src/public/errors.ts";
export type { HtmlOperationalError } from "../src/public/errors.ts";
export type {
  HtmlBudgetName,
  HtmlConfigurationErrorReason,
  HtmlPatchPlanningReason,
  NodeId,
  TraceBudgetEvent,
  TraceDecodeEvent,
  TraceEvent,
  TraceEventCallback,
  TraceEventsResult,
  TraceInsertionModeTransitionEvent,
  TraceMode,
  TraceParseErrorEvent,
  TraceResult,
  TraceStreamEvent,
  TraceSummary,
  TraceSummaryResult,
  TraceTokenEvent,
  TraceTreeMutationEvent
} from "../src/public/types.ts";

/**
 * Parse budget controls for bounding CPU/memory usage.
 */
export interface ParseBudgets {
  /** Maximum UTF-8 text bytes or byte/stream transport bytes accepted. */
  readonly maxInputBytes?: number;
  /** Maximum UTF-8 bytes in the decoded HTML text. */
  readonly maxDecodedUtf8Bytes?: number;
  /** Maximum public-root and parser node allocations, including recovery nodes. */
  readonly maxNodes?: number;
  /** Maximum tree depth, with the public root at depth one. */
  readonly maxDepth?: number;
  /** Maximum parse diagnostics emitted during tree construction. */
  readonly maxParseErrors?: number;
  /** Maximum attempted start-tag attributes, including discarded duplicates. */
  readonly maxAttributesPerElement?: number;
  /** Maximum attempted name/value UTF-8 bytes on one start tag. */
  readonly maxAttributeBytes?: number;
  /** Maximum retained trace event count; valid only with `trace: "events"`. */
  readonly maxTraceEvents?: number;
  /** Maximum retained canonical event JSON bytes; valid only with `trace: "events"`. */
  readonly maxTraceBytes?: number;
  /** Maximum parse/decode elapsed time measured by a monotonic clock. */
  readonly maxTimeMs?: number;
}

/**
 * Options accepted by parse entrypoints.
 */
export interface ParseOptions {
  /** Include source span offsets on nodes and attributes. */
  readonly captureSpans?: boolean;
  /** Exact decoded source retention; defaults to `"none"`. */
  readonly sourceRetention?: SourceRetention;
  /** Returned trace retention mode; defaults to `"none"`. */
  readonly trace?: TraceMode;
  /** Synchronously observes each immutable trace event without requiring retention. */
  readonly onTraceEvent?: TraceEventCallback;
  /** Optional budget controls for parse/decode operations. */
  readonly budgets?: ParseBudgets;
  /** Optional cancellation signal shared by every parse phase. */
  readonly signal?: AbortSignal;
}

/** Decoded-source retention for a full-document parse result. */
export type SourceRetention = "none" | "text";

/** Options accepted by byte parsing. */
export interface ParseBytesOptions extends ParseOptions {
  /** Optional transport encoding hint considered during HTML encoding sniffing. */
  readonly transportEncodingLabel?: string;
}

/** Options accepted by already-decoded fragment parsing. */
export type ParseFragmentOptions = Omit<ParseOptions, "sourceRetention">;

/** Parse limits for byte streams, including bounded encoding-prescan retention. */
export interface ParseStreamBudgets extends ParseBudgets {
  /** Maximum transport bytes retained for encoding prescan; zero disables it. */
  readonly maxEncodingPrescanBytes?: number;
}

/** Options accepted by full-document byte-stream parsing. */
export interface ParseStreamOptions extends Omit<ParseBytesOptions, "budgets"> {
  /** Optional parse and stream-retention controls. */
  readonly budgets?: ParseStreamBudgets;
}

/** Resource limits that apply to eager byte-stream decoding and tokenization. */
export type TokenizeByteStreamEagerBudgets = Pick<
  ParseStreamBudgets,
  | "maxInputBytes"
  | "maxEncodingPrescanBytes"
  | "maxDecodedUtf8Bytes"
  | "maxParseErrors"
  | "maxAttributesPerElement"
  | "maxAttributeBytes"
  | "maxTimeMs"
>;

/**
 * Options accepted by stream tokenization.
 */
export interface TokenizeByteStreamEagerOptions {
  /** Optional transport encoding hint for stream decoding. */
  readonly transportEncodingLabel?: string;
  /** Optional budget controls for stream tokenization. */
  readonly budgets?: TokenizeByteStreamEagerBudgets;
  /** Optional cancellation signal shared by decode and tokenization. */
  readonly signal?: AbortSignal;
}

/** Deadline and cancellation controls for one non-parse operation. */
export interface OperationOptions {
  /** Inclusive monotonic elapsed-time limit in milliseconds. */
  readonly maxTimeMs?: number;
  /** Optional cancellation signal for the operation. */
  readonly signal?: AbortSignal;
}

/**
 * Options accepted by visible text extraction.
 */
export interface VisibleTextOptions extends OperationOptions {
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
  readonly code: "PARSER_ERROR";
  /** Deterministic WHATWG parse-error identifier. */
  readonly parseErrorId: string;
  /** Human-readable failure message. */
  readonly message: string;
  /** Optional node id associated with the diagnostic. */
  readonly nodeId?: number;
  /** Optional input offsets associated with the diagnostic. */
  readonly span?: Span;
}

/** Zero-based, half-open UTF-16 code-unit offsets into decoded input. */
export interface Span {
  /** Inclusive start offset. */
  readonly start: number;
  /** Exclusive end offset. */
  readonly end: number;
}

/** Explains whether a source span came from input, recovery, or disabled capture. */
export type SpanProvenance = "input" | "inferred" | "none";

/** Namespace-aware parsed attribute. */
export interface Attribute {
  /** Namespace URI, or null for an unnamespaced attribute. */
  readonly namespaceUri: string | null;
  /** Namespace prefix, or null when unprefixed. */
  readonly prefix: string | null;
  /** Attribute local name. */
  readonly localName: string;
  /** Qualified attribute name. */
  readonly name: string;
  /** Decoded attribute value. */
  readonly value: string;
  /** Full input attribute span when captured. */
  readonly span?: Span;
}

/** Parsed text node. */
export interface TextNode {
  /** Stable node id in this parsed tree. */
  readonly id: number;
  /** Node discriminator. */
  readonly kind: "text";
  /** Decoded text value. */
  readonly value: string;
  /** Source-span provenance. */
  readonly spanProvenance: SpanProvenance;
  /** Input span when available. */
  readonly span?: Span;
}

/** Parsed comment node. */
export interface CommentNode {
  /** Stable node id in this parsed tree. */
  readonly id: number;
  /** Node discriminator. */
  readonly kind: "comment";
  /** Comment data. */
  readonly value: string;
  /** Source-span provenance. */
  readonly spanProvenance: SpanProvenance;
  /** Input span when available. */
  readonly span?: Span;
}

/** External identifier retained from a document type declaration. */
export type DoctypeExternalId =
  | { readonly kind: "none" }
  | { readonly kind: "public"; readonly publicId: string; readonly systemId: string | null }
  | { readonly kind: "system"; readonly systemId: string };

/** Parsed document type node. */
export interface DoctypeNode {
  /** Stable node id in this parsed tree. */
  readonly id: number;
  /** Node discriminator. */
  readonly kind: "doctype";
  /** Document type name. */
  readonly name: string;
  /** Exact external-identifier syntax state. */
  readonly externalId: DoctypeExternalId;
  /** Source-span provenance. */
  readonly spanProvenance: SpanProvenance;
  /** Input span when available. */
  readonly span?: Span;
}

/** Namespace-aware parsed element node. */
export interface ElementNode {
  /** Stable node id in this parsed tree. */
  readonly id: number;
  /** Node discriminator. */
  readonly kind: "element";
  /** Element namespace URI. */
  readonly namespaceUri: string;
  /** Parser-provided prefix, or null. */
  readonly prefix: string | null;
  /** Element local name. */
  readonly localName: string;
  /** Qualified element name. */
  readonly tagName: string;
  /** Namespace-aware attributes in tree order. */
  readonly attributes: readonly Attribute[];
  /** Child nodes in tree order. */
  readonly children: readonly HtmlNode[];
  /** Source-span provenance. */
  readonly spanProvenance: SpanProvenance;
  /** Input span when available. */
  readonly span?: Span;
}

/** Exact public node union returned by parse entrypoints. */
export type HtmlNode = ElementNode | TextNode | CommentNode | DoctypeNode;

/**
 * Parsed HTML document tree nested under `ParsedDocument.tree`.
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
  /** Deterministic summary or retained events when requested by `options.trace`. */
  readonly trace?: TraceResult;
}

/** Successful full-document parser resource observations. */
export interface ParseResourceUsage {
  /** UTF-8 bytes for text input or supplied transport bytes for byte/stream input. */
  readonly inputBytes: number;
  /** UTF-8 bytes in the exact decoded source. */
  readonly decodedUtf8Bytes: number;
  /** UTF-16 code units in the exact decoded source. */
  readonly decodedCodeUnits: number;
  /** Public root plus input and recovery allocations counted by `maxNodes`. */
  readonly nodes: number;
  /** Highest parser-assigned depth, with the public root at depth one. */
  readonly maxDepth: number;
  /** Parse diagnostics emitted during tree construction. */
  readonly parseErrors: number;
  /** Attempted start-tag attributes, including discarded duplicates. */
  readonly attributes: number;
  /** UTF-8 bytes in attempted attribute names and decoded values. */
  readonly attributeUtf8Bytes: number;
  /** Stream encoding-prescan retained-byte high-water mark; zero otherwise. */
  readonly encodingPrescanBytes: number;
  /** Observable trace events emitted by tracing or an observer. */
  readonly traceEvents: number;
  /** Canonical event UTF-8 bytes accounted in retained trace modes. */
  readonly traceUtf8Bytes: number;
}

/** Encoding evidence produced by the same pipeline that built the tree. */
export interface ParseEncodingMetadata {
  /** Selected WHATWG encoding, or null for already-decoded text. */
  readonly name: string | null;
  /** Evidence that selected the encoding. */
  readonly source: "already-decoded" | "bom" | "transport" | "meta" | "default";
}

/** Deterministic metadata for one full-document parse. */
export interface ParsedDocumentMetadata {
  /** Public input variant used by this parse. */
  readonly inputKind: "text" | "bytes" | "stream";
  /** Supplied transport bytes, or null for already-decoded text. */
  readonly transportByteLength: number | null;
  /** Encoding evidence from the pipeline that built the tree. */
  readonly encoding: ParseEncodingMetadata;
  /** Successful deterministic parser resource observations. */
  readonly resourceUsage: ParseResourceUsage;
}

/** Canonical result returned by every full-document parse entrypoint. */
export interface ParsedDocument {
  /** Parsed document tree. */
  readonly tree: DocumentTree;
  /** Exact decoded source when requested; otherwise null. */
  readonly sourceText: string | null;
  /** Input, encoding, and resource evidence from this parse. */
  readonly metadata: ParsedDocumentMetadata;
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
  /** Deterministic summary or retained events when requested by `options.trace`. */
  readonly trace?: TraceResult;
}

/**
 * Input accepted by `serialize`.
 */
export type SerializableHtml = DocumentTree | FragmentTree | HtmlNode;

/**
 * Input accepted by `visibleText`.
 */
export type VisibleTextInput = DocumentTree | FragmentTree | HtmlNode;

/** HTML namespace URI assigned by the tree builder. */
export const HTML_NAMESPACE_URI: string = HTML_NAMESPACE_URI_INTERNAL;
/** SVG namespace URI assigned by the tree builder. */
export const SVG_NAMESPACE_URI: string = SVG_NAMESPACE_URI_INTERNAL;
/** MathML namespace URI assigned by the tree builder. */
export const MATHML_NAMESPACE_URI: string = MATHML_NAMESPACE_URI_INTERNAL;
/** XLink namespace URI used by adjusted foreign attributes. */
export const XLINK_NAMESPACE_URI: string = XLINK_NAMESPACE_URI_INTERNAL;
/** XML namespace URI used by adjusted foreign attributes. */
export const XML_NAMESPACE_URI: string = XML_NAMESPACE_URI_INTERNAL;
/** XMLNS namespace URI used by namespace declaration attributes. */
export const XMLNS_NAMESPACE_URI: string = XMLNS_NAMESPACE_URI_INTERNAL;

/** Returns an unnamespaced HTML attribute using ASCII case-insensitive matching. */
export function getAttributeValue(node: ElementNode, name: string): string | undefined {
  return getAttributeValueInternal(node, name);
}

/** Tests for an unnamespaced HTML attribute using ASCII case-insensitive matching. */
export function hasAttribute(node: ElementNode, name: string): boolean {
  return hasAttributeInternal(node, name);
}

/** Returns an attribute value by exact namespace URI and local name. */
export function getAttributeValueNS(
  node: ElementNode,
  namespaceUri: string | null,
  localName: string
): string | undefined {
  return getAttributeValueNSInternal(node, namespaceUri, localName);
}

/** Tests for an attribute by exact namespace URI and local name. */
export function hasAttributeNS(
  node: ElementNode,
  namespaceUri: string | null,
  localName: string
): boolean {
  return hasAttributeNSInternal(node, namespaceUri, localName);
}

/** Finds HTML elements by ASCII case-insensitive local name. */
export function findAllByTagName(
  tree: DocumentTree | FragmentTree,
  tagName: string,
  options: OperationOptions = {}
): IterableIterator<ElementNode> {
  return findAllByTagNameInternal(
    tree as Parameters<typeof findAllByTagNameInternal>[0],
    tagName,
    options
  );
}

/** Finds elements by exact namespace URI and local name. */
export function findAllByTagNameNS(
  tree: DocumentTree | FragmentTree,
  namespaceUri: string,
  localName: string,
  options: OperationOptions = {}
): IterableIterator<ElementNode> {
  return findAllByTagNameNSInternal(
    tree as Parameters<typeof findAllByTagNameNSInternal>[0],
    namespaceUri,
    localName,
    options
  );
}

/** Finds HTML elements carrying an unnamespaced attribute. */
export function findAllByAttr(
  tree: DocumentTree | FragmentTree,
  name: string,
  value?: string,
  options: OperationOptions = {}
): IterableIterator<ElementNode> {
  return findAllByAttrInternal(
    tree as Parameters<typeof findAllByAttrInternal>[0],
    name,
    value,
    options
  );
}

/** Finds elements carrying an attribute with an exact expanded name. */
export function findAllByAttrNS(
  tree: DocumentTree | FragmentTree,
  namespaceUri: string | null,
  localName: string,
  value?: string,
  options: OperationOptions = {}
): IterableIterator<ElementNode> {
  return findAllByAttrNSInternal(
    tree as Parameters<typeof findAllByAttrNSInternal>[0],
    namespaceUri,
    localName,
    value,
    options
  );
}

/**
 * Token returned by `tokenizeByteStreamEager` after complete input consumption.
 */
export interface HtmlToken {
  /** Token category produced by eager byte-stream tokenization. */
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
 * Parses full HTML input into a deterministic document result.
 *
 * @param input HTML source text to parse.
 * @param options Parse controls for spans, tracing, and resource budgets.
 * @returns `ParsedDocument` with a tree, optional retained source, and metadata.
 * @throws {HtmlBudgetExceededError} When a configured resource budget is exceeded.
 * @throws {HtmlAbortError} When `options.signal` is aborted.
 *
 * Security and limits:
 * - Use strict `budgets` for untrusted input.
 * - Parsing is structural analysis, not sanitization.
 *
 * @example
 * ```ts
 * import { parse } from "./mod.ts";
 *
 * const document = parse("<article><h1>News</h1><p>Stable output</p></article>", {
 *   budgets: { maxInputBytes: 8_192, maxNodes: 512, maxDepth: 64 }
 * });
 *
 * console.log(document.tree.kind);
 * console.log(document.tree.children.length);
 * ```
 */
export function parse(input: string, options: ParseOptions = {}): ParsedDocument {
  return parseInternal(input, options as Parameters<typeof parseInternal>[1]) as ParsedDocument;
}

/**
 * Parses byte-oriented HTML input with encoding sniffing.
 *
 * @param input UTF-8 or legacy-encoded bytes.
 * @param options Parse controls for encoding hints, tracing, and budgets.
 * @returns `ParsedDocument` for decoded HTML input.
 * @throws {HtmlBudgetExceededError} When a configured resource budget is exceeded.
 * @throws {HtmlAbortError} When `options.signal` is aborted.
 */
export function parseBytes(input: Uint8Array, options: ParseBytesOptions = {}): ParsedDocument {
  return parseBytesInternal(input, options as Parameters<typeof parseBytesInternal>[1]) as ParsedDocument;
}

/**
 * Parses markup relative to a fragment context element.
 *
 * @param html Fragment HTML source text.
 * @param contextTagName Context element tag name (for example `"template"` or `"table"`).
 * Use the real embedding element so recovery behavior matches browser fragment parsing.
 * @param options Parse controls for tracing and budgets.
 * @returns Parsed `FragmentTree` scoped to the requested context with non-fatal diagnostics.
 * @throws {HtmlConfigurationError} When the fragment context is invalid.
 * @throws {HtmlBudgetExceededError} When a configured resource budget is exceeded.
 * @throws {HtmlAbortError} When `options.signal` is aborted.
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
  options: ParseFragmentOptions = {}
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
 * `budgets.maxInputBytes` bounds the full stream and `budgets.maxEncodingPrescanBytes`
 * caps the encoding-prescan memory retained before decoding begins.
 * The operation consumes through EOF, retains the complete decoded document,
 * and only then parses it. The reader lock is released before this promise
 * settles.
 *
 * @returns Promise resolving to a `ParsedDocument` with accumulated diagnostics and metadata.
 * @throws {HtmlStreamReadError} When acquiring or reading the stream fails.
 * @throws {HtmlBudgetExceededError} When a configured resource budget is exceeded.
 * @throws {HtmlAbortError} When `options.signal` is aborted.
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
 * const document = await parseStream(stream, {
 *   budgets: { maxInputBytes: 8_192, maxEncodingPrescanBytes: 1_024, maxNodes: 512 }
 * });
 *
 * console.log(document.tree.kind);
 * ```
 */
export async function parseStream(
  input: ReadableStream<Uint8Array>,
  options: ParseStreamOptions = {}
): Promise<ParsedDocument> {
  return parseStreamInternal(
    input,
    options as Parameters<typeof parseStreamInternal>[1]
  ) as Promise<ParsedDocument>;
}

/**
 * Serializes a parsed document, fragment, or node back to HTML text.
 *
 * @param input Parsed tree or node.
 * @param options Optional monotonic deadline and cancellation signal.
 * @returns Deterministic HTML serialization output.
 * @throws {HtmlAbortError} When `options.signal` is aborted.
 * @throws {HtmlBudgetExceededError} When `options.maxTimeMs` expires.
 */
export function serialize(input: SerializableHtml, options: OperationOptions = {}): string {
  return serializeInternal(
    input as Parameters<typeof serializeInternal>[0],
    options as Parameters<typeof serializeInternal>[1]
  );
}

/**
 * Extracts visible text from a parsed tree or node.
 *
 * @param input Parsed document, fragment, or node.
 * @param options Visible-text extraction controls. Hidden-subtree skipping is
 * enabled by default; broaden extraction only when you explicitly need more source text.
 * @returns Stable text output suitable for indexing and plain-text auditing.
 * @throws {HtmlAbortError} When `options.signal` is aborted.
 * @throws {HtmlBudgetExceededError} When `options.maxTimeMs` expires.
 *
 * Failure mode:
 * - This function does not sanitize HTML; it only returns text.
 *
 * @example
 * ```ts
 * import { parse, visibleText } from "./mod.ts";
 *
 * const document = parse("<main><h1>Hello</h1><p>World</p></main>");
 * console.log(visibleText(document.tree, { trim: true }));
 * ```
 */
export function visibleText(input: VisibleTextInput, options: VisibleTextOptions = {}): string {
  return visibleTextInternal(
    input as Parameters<typeof visibleTextInternal>[0],
    options as Parameters<typeof visibleTextInternal>[1]
  );
}

/**
 * Eagerly tokenizes HTML bytes from a readable stream.
 *
 * The complete byte stream is read and decoded before tokenization. No token is
 * observable before EOF, and the reader lock is released before this promise
 * settles.
 *
 * @param input Stream of HTML bytes.
 * @param options Stream tokenization controls and budgets.
 * @returns Promise resolving to all parser-compatible HTML tokens in source order.
 * @throws {HtmlStreamReadError} When acquiring or reading the stream fails.
 * @throws {HtmlBudgetExceededError} When a configured resource budget is exceeded.
 * @throws {HtmlAbortError} When `options.signal` is aborted.
 */
export async function tokenizeByteStreamEager(
  input: ReadableStream<Uint8Array>,
  options: TokenizeByteStreamEagerOptions = {}
): Promise<readonly HtmlToken[]> {
  return tokenizeByteStreamEagerInternal(
    input,
    options as Parameters<typeof tokenizeByteStreamEagerInternal>[1]
  );
}
