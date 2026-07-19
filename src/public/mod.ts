import { decodeHtmlBytes, sniffHtmlEncoding } from "../internal/encoding/mod.js";
import { requireInternalValue } from "../internal/foundation/internal-state-error.js";
import { tokenize, type HtmlToken } from "../internal/tokenizer/mod.js";
import {
  buildTreeFromHtml,
  TreeBudgetExceededError,
  type TreeAttribute,
  type TreeBuildOptions,
  type TreeBuildResult,
  type TreeBudgets,
  type TreeNode,
  type TreeSpan
} from "../internal/tree/mod.js";

import {
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
} from "./errors.js";
import {
  createOperationContext,
  normalizeChunkOptions,
  normalizeOperationOptions,
  normalizeParseBytesOptions,
  normalizeParseFragmentOptions,
  normalizeParseOptions,
  normalizeParseStreamOptions,
  normalizeTextExtractionOptions,
  normalizeTokenizeByteStreamEagerOptions,
  type OperationContext
} from "./operation.js";

import type {
  Attribute,
  ParseBudgetOptions,
  Chunk,
  ChunkOptions,
  DocumentTree,
  Edit,
  ElementVisitor,
  FragmentTree,
  HtmlBudgetName,
  HtmlNode,
  HtmlPatchPlanningReason,
  NodeId,
  NodeVisitor,
  OperationOptions,
  Outline,
  OutlineEntry,
  PatchPlan,
  PatchStep,
  ParseError,
  ParseBytesOptions,
  ParseFragmentOptions,
  ParseOptions,
  ParsedDocument,
  ParsedDocumentMetadata,
  ParseStreamBudgetOptions,
  ParseStreamOptions,
  ParseResourceUsage,
  Span,
  SpanProvenance,
  TextContentExtractionOptions,
  TextExtractionOptions,
  TextExtractionPolicy,
  TextExtractionResult,
  TextExtractionSourceNodeKind,
  TextExtractionSourceRole,
  TextExtractionToken,
  TextExtractionTokenKind,
  TextProvenanceRange,
  Token,
  TokenizeByteStreamEagerOptions,
  TraceEvent,
  TraceEventCallback,
  TraceMode,
  TraceResult,
  TraceSummary,
  VisibleTextExtractionOptions
} from "./types.js";

export type {
  Attribute,
  ParseBudgetOptions,
  CharsToken,
  Chunk,
  ChunkOptions,
  CommentNode,
  DoctypeToken,
  DocumentTree,
  DoctypeExternalId,
  DoctypeNode,
  Edit,
  ElementVisitor,
  EndTagToken,
  EofToken,
  ElementNode,
  FragmentTree,
  OperationOptions,
  HtmlBudgetName,
  HtmlConfigurationErrorReason,
  HtmlNode,
  HtmlPatchPlanningReason,
  NodeId,
  NodeKind,
  NodeVisitor,
  Outline,
  OutlineEntry,
  PatchInsertStep,
  PatchPlan,
  PatchSliceStep,
  PatchStep,
  ParseError,
  ParseBytesOptions,
  ParseFragmentOptions,
  ParseOptions,
  ParsedDocument,
  ParsedDocumentMetadata,
  ParseEncodingMetadata,
  ParseResourceUsage,
  ParseStreamBudgetOptions,
  ParseStreamOptions,
  Span,
  SpanProvenance,
  TextContentExtractionOptions,
  TextExtractionOptions,
  TextExtractionOptionsBase,
  TextExtractionPolicy,
  TextExtractionResult,
  TextExtractionSourceNodeKind,
  TextExtractionSourceRole,
  TextExtractionToken,
  TextExtractionTokenKind,
  TextProvenanceRange,
  SourceRetention,
  StartTagToken,
  Token,
  TokenAttribute,
  TokenizeByteStreamEagerBudgetOptions,
  TokenizeByteStreamEagerOptions,
  TraceEventCallback,
  TraceBudgetEvent,
  TraceDecodeEvent,
  TraceInsertionModeTransitionEvent,
  TraceParseErrorEvent,
  TraceStreamEvent,
  TraceTokenEvent,
  TraceTreeMutationEvent,
  TextNode,
  TraceEvent,
  TraceEventsResult,
  TraceMode,
  TraceResult,
  TraceSummary,
  TraceSummaryResult,
  VisibleTextExtractionOptions
} from "./types.js";

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
};
export type { HtmlOperationalError } from "./errors.js";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

/** HTML namespace URI assigned by the tree builder. */
export const HTML_NAMESPACE_URI = "http://www.w3.org/1999/xhtml";
/** SVG namespace URI assigned by the tree builder. */
export const SVG_NAMESPACE_URI = "http://www.w3.org/2000/svg";
/** MathML namespace URI assigned by the tree builder. */
export const MATHML_NAMESPACE_URI = "http://www.w3.org/1998/Math/MathML";
/** XLink namespace URI used by adjusted foreign attributes. */
export const XLINK_NAMESPACE_URI = "http://www.w3.org/1999/xlink";
/** XML namespace URI used by adjusted foreign attributes. */
export const XML_NAMESPACE_URI = "http://www.w3.org/XML/1998/namespace";
/** XMLNS namespace URI used by namespace declaration attributes. */
export const XMLNS_NAMESPACE_URI = "http://www.w3.org/2000/xmlns/";
/** Stable semantic identity for visible HTML text extraction. */
export const VISIBLE_TEXT_HTML_POLICY = "visible-text-html-v1";
/** Stable semantic identity for raw DOM text-content extraction. */
export const TEXT_CONTENT_POLICY = "text-content-v1";
const DEFAULT_STREAM_ENCODING_PRESCAN_BYTES = 16_384;
const parsedDocumentSources = new WeakMap<object, string | null>();
const parsedDocumentSpans = new WeakMap<object, boolean>();
const patchPlanDocuments = new WeakMap<object, ParsedDocument>();

class NodeIdAssigner {
  #next: NodeId = 1;

  next(): NodeId {
    const value = this.#next;
    this.#next += 1;
    return value;
  }
}

interface NodeMetrics {
  readonly nodes: number;
  readonly maxDepth: number;
}

function enforceBudget(
  budget: HtmlBudgetName,
  limit: number | undefined,
  actual: number
): void {
  if (limit === undefined || actual <= limit) {
    return;
  }

  throw new HtmlBudgetExceededError(budget, limit, limit + 1);
}

function requireString(value: unknown, option: string): asserts value is string {
  if (typeof value !== "string") {
    throw new HtmlConfigurationError(option, "INVALID_VALUE", "must be a string");
  }
}

function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function isHtmlElement(node: HtmlNode): node is Extract<HtmlNode, { kind: "element" }> {
  return node.kind === "element" && node.namespaceUri === HTML_NAMESPACE_URI;
}

function requireByteArray(value: unknown, option: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new HtmlConfigurationError(option, "INVALID_VALUE", "must be a Uint8Array");
  }
}

function requireReadableByteStream(
  value: unknown,
  option: string
): asserts value is ReadableStream<Uint8Array> {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Readonly<Record<PropertyKey, unknown>>)["getReader"] !== "function"
  ) {
    throw new HtmlConfigurationError(
      option,
      "INVALID_VALUE",
      "must be a ReadableStream of Uint8Array chunks"
    );
  }
}

function parseOperationContext(options: ParseOptions, startedAt: number): OperationContext {
  return createOperationContext(options.budgets?.maxTimeMs, options.signal, startedAt);
}

function utf8ByteLength(value: string, operation?: OperationContext): number {
  let bytes = 0;
  let cursor = 0;
  while (cursor < value.length) {
    operation?.checkpoint();
    const codePoint = value.codePointAt(cursor);
    if (codePoint === undefined) {
      break;
    }
    const width = codePoint > 0xffff ? 2 : 1;
    bytes += codePointUtf8ByteLength(codePoint);
    cursor += width;
  }
  return bytes;
}

class DecodedUtf8BudgetCounter {
  readonly #limit: number | undefined;
  readonly #operation: OperationContext;
  readonly #encoder = new TextEncoder();
  #bytes = 0;

  constructor(limit: number | undefined, operation: OperationContext) {
    this.#limit = limit;
    this.#operation = operation;
  }

  append(value: string): void {
    this.#operation.checkpoint();
    this.#bytes += this.#encoder.encode(value).byteLength;
    enforceBudget("maxDecodedUtf8Bytes", this.#limit, this.#bytes);
  }

  get bytes(): number {
    return this.#bytes;
  }
}

type TraceEventInput =
  TraceEvent extends infer Event
    ? Event extends { readonly seq: number }
      ? Omit<Event, "seq">
      : never
    : never;

interface TraceFinalMetrics {
  readonly tokenCount: number;
  readonly nodeCount: number;
  readonly maxDepth: number;
  readonly parseErrorCount: number;
  readonly encoding: TraceSummary["encoding"];
  readonly inputBytes: number;
  readonly decodedUtf8Bytes: number;
  readonly bytesRead: number | null;
  readonly encodingPrescanBytes: number | null;
  readonly encodingPrescanLimitBytes: number | null;
}

function freezeTraceEvent(seq: number, input: TraceEventInput): TraceEvent {
  if (input.kind === "insertionModeTransition") {
    return Object.freeze({
      seq,
      ...input,
      tokenContext: Object.freeze({ ...input.tokenContext })
    });
  }
  return Object.freeze({ seq, ...input });
}

class TraceSink {
  readonly #mode: TraceMode;
  readonly #callback: TraceEventCallback | undefined;
  readonly #budgets: ParseOptions["budgets"] | undefined;
  readonly #operation: OperationContext;
  readonly #encoder = new TextEncoder();
  readonly #events: TraceEvent[] | undefined;
  readonly #eventKinds = new Set<TraceEvent["kind"]>();
  #eventCount = 0;
  #eventUtf8Bytes = 0;

  constructor(
    mode: TraceMode,
    callback: TraceEventCallback | undefined,
    budgets: ParseOptions["budgets"] | undefined,
    operation: OperationContext
  ) {
    this.#mode = mode;
    this.#callback = callback;
    this.#budgets = budgets;
    this.#operation = operation;
    this.#events = mode === "events" ? [] : undefined;
  }

  get active(): boolean {
    return this.#mode !== "none" || this.#callback !== undefined;
  }

  get eventCount(): number {
    return this.#eventCount;
  }

  get eventUtf8Bytes(): number {
    return this.#eventUtf8Bytes;
  }

  emit(input: TraceEventInput): void {
    if (!this.active) {
      return;
    }
    this.#operation.checkpoint();
    const event = freezeTraceEvent(this.#eventCount + 1, input);
    const eventBytes = this.#mode === "none"
      ? 0
      : this.#encoder.encode(JSON.stringify(event)).byteLength;

    if (this.#events !== undefined) {
      enforceBudget("maxTraceEvents", this.#budgets?.maxTraceEvents, this.#events.length + 1);
      enforceBudget(
        "maxTraceBytes",
        this.#budgets?.maxTraceBytes,
        this.#eventUtf8Bytes + eventBytes
      );
      this.#events.push(event);
    }

    this.#eventCount += 1;
    if (this.#mode !== "none") {
      this.#eventUtf8Bytes += eventBytes;
      this.#eventKinds.add(event.kind);
    }
    this.#callback?.(event);
    this.#operation.checkpoint();
  }

  emitBudget(budget: HtmlBudgetName, limit: number | undefined, actual: number): void {
    this.emit({
      kind: "budget",
      budget,
      limit: limit ?? null,
      actual,
      status: limit === undefined || actual <= limit ? "ok" : "exceeded"
    });
  }

  finish(metrics: TraceFinalMetrics): TraceResult | undefined {
    if (this.#mode === "none") {
      return undefined;
    }
    const summary: TraceSummary = Object.freeze({
      ...metrics,
      encoding: Object.freeze({ ...metrics.encoding }),
      eventCount: this.#eventCount,
      eventUtf8Bytes: this.#eventUtf8Bytes,
      eventKinds: Object.freeze([...this.#eventKinds].sort())
    });
    if (this.#events === undefined) {
      return Object.freeze({ mode: "summary", summary });
    }
    return Object.freeze({
      mode: "events",
      summary,
      events: Object.freeze(this.#events)
    });
  }
}

function toPublicSpan(span: TreeSpan | undefined, captureSpans: boolean): Span | undefined {
  if (!captureSpans || !span) {
    return undefined;
  }

  return Object.freeze({ start: span.start, end: span.end });
}

function toSpanProvenance(span: TreeSpan | undefined, captureSpans: boolean): SpanProvenance {
  if (!captureSpans) {
    return "none";
  }
  return span ? "input" : "inferred";
}

function toAttributes(
  attributes: readonly TreeAttribute[],
  captureSpans: boolean,
  operation: OperationContext
): readonly Attribute[] {
  return Object.freeze(attributes.map((attribute) => {
    operation.checkpoint();
    const span = toPublicSpan(attribute.span, captureSpans);
    return Object.freeze({
      namespaceUri: attribute.namespaceUri,
      prefix: attribute.prefix,
      localName: attribute.localName,
      name: attribute.name,
      value: attribute.value,
      ...(span ? { span } : {})
    });
  }));
}

const WHATWG_PARSE_ERRORS_SECTION_URL = "https://html.spec.whatwg.org/multipage/parsing.html#parse-errors";
const WHATWG_PARSE_ERROR_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeParseErrorId(rawErrorCode: string): string {
  const normalized = rawErrorCode.trim();
  if (normalized.length === 0) {
    return "vendor:unknown";
  }
  if (WHATWG_PARSE_ERROR_ID_PATTERN.test(normalized)) {
    return normalized;
  }
  return `vendor:${normalized}`;
}/**
 * Returns deterministic public metadata for `getParseErrorSpecRef`.
 */


export function getParseErrorSpecRef(parseErrorId: string): string {
  void parseErrorId;
  return WHATWG_PARSE_ERRORS_SECTION_URL;
}

function toParseErrors(
  errors: readonly {
    readonly code: string;
    readonly startOffset?: number;
    readonly endOffset?: number;
  }[],
  operation: OperationContext
): readonly ParseError[] {
  return Object.freeze(errors.map((error) => {
    operation.checkpoint();
    const hasOffsets =
      typeof error.startOffset === "number" &&
      typeof error.endOffset === "number" &&
      error.startOffset >= 0 &&
      error.endOffset >= error.startOffset;
    const parseErrorId = normalizeParseErrorId(error.code);
    return Object.freeze({
      code: "PARSER_ERROR",
      parseErrorId,
      message: error.code,
      ...(hasOffsets
        ? {
            span: Object.freeze({
              start: error.startOffset,
              end: error.endOffset
            })
          }
        : {})
    });
  }));
}

function toToken(token: HtmlToken): Token {
  if (token.type === "StartTag") {
    const attributes = Object.entries(token.attributes).map(([name, value]) =>
      Object.freeze({ name, value })
    );
    return Object.freeze({
      kind: "startTag",
      name: token.name,
      attributes: Object.freeze(attributes),
      selfClosing: token.selfClosing
    });
  }

  if (token.type === "EndTag") {
    return Object.freeze({
      kind: "endTag",
      name: token.name
    });
  }

  if (token.type === "Character") {
    return Object.freeze({
      kind: "chars",
      value: token.data
    });
  }

  if (token.type === "Comment") {
    return Object.freeze({
      kind: "comment",
      value: token.data
    });
  }

  if (token.type === "Doctype") {
    return Object.freeze({
      kind: "doctype",
      name: token.name,
      publicId: token.publicId,
      systemId: token.systemId,
      forceQuirks: token.forceQuirks
    });
  }

  return Object.freeze({
    kind: "eof"
  });
}

function treeBudgetsFromParseOptions(budgets: ParseOptions["budgets"] | undefined): TreeBudgets | undefined {
  if (!budgets) {
    return undefined;
  }

  const next: TreeBudgets = {
    ...(budgets.maxNodes !== undefined ? { maxNodes: budgets.maxNodes } : {}),
    ...(budgets.maxDepth !== undefined ? { maxDepth: budgets.maxDepth } : {}),
    ...(budgets.maxParseErrors !== undefined ? { maxParseErrors: budgets.maxParseErrors } : {}),
    ...(budgets.maxAttributesPerElement !== undefined
      ? { maxAttributesPerElement: budgets.maxAttributesPerElement }
      : {}),
    ...(budgets.maxAttributeBytes !== undefined
      ? { maxAttributeBytes: budgets.maxAttributeBytes }
      : {})
  };

  return Object.keys(next).length > 0 ? next : undefined;
}

function enforceTokenAttributeBudgets(
  attributes: readonly Readonly<{ readonly name: string; readonly value: string }>[],
  budgets: Pick<ParseBudgetOptions, "maxAttributesPerElement" | "maxAttributeBytes"> | undefined
): void {
  enforceBudget(
    "maxAttributesPerElement",
    budgets?.maxAttributesPerElement,
    attributes.length
  );
  if (budgets?.maxAttributeBytes === undefined) {
    return;
  }
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const attribute of attributes) {
    bytes += encoder.encode(attribute.name).byteLength;
    bytes += encoder.encode(attribute.value).byteLength;
    enforceBudget("maxAttributeBytes", budgets.maxAttributeBytes, bytes);
  }
}

function buildHtmlTree(
  html: string,
  budgets: ParseOptions["budgets"] | undefined,
  options: TreeBuildOptions
): TreeBuildResult {
  try {
    return buildTreeFromHtml(html, treeBudgetsFromParseOptions(budgets), options);
  } catch (error) {
    if (error instanceof TreeBudgetExceededError) {
      throw new HtmlBudgetExceededError(error.budget, error.limit, error.actual);
    }
    throw error;
  }
}

function convertTreeNodes(
  nodes: readonly TreeNode[],
  assigner: NodeIdAssigner,
  captureSpans: boolean,
  operation: OperationContext
): readonly HtmlNode[] {
  const converted = new WeakMap<object, HtmlNode>();
  const stack: { readonly node: TreeNode; readonly exiting: boolean }[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node !== undefined) {
      stack.push({ node, exiting: false });
    }
  }

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) {
      continue;
    }
    operation.checkpoint();
    const { node } = frame;
    if (node.kind === "element" && !frame.exiting) {
      stack.push({ node, exiting: true });
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        if (child !== undefined) {
          stack.push({ node: child, exiting: false });
        }
      }
      continue;
    }

    const span = toPublicSpan(node.span, captureSpans);
    const spanProvenance = toSpanProvenance(node.span, captureSpans);
    let publicNode: HtmlNode;
    if (node.kind === "text") {
      publicNode = {
        id: assigner.next(), kind: "text", value: node.value, spanProvenance,
        ...(span ? { span } : {})
      };
    } else if (node.kind === "comment") {
      publicNode = {
        id: assigner.next(), kind: "comment", value: node.value, spanProvenance,
        ...(span ? { span } : {})
      };
    } else if (node.kind === "doctype") {
      publicNode = {
        id: assigner.next(), kind: "doctype", name: node.name,
        externalId: Object.freeze({ ...node.externalId }), spanProvenance,
        ...(span ? { span } : {})
      };
    } else {
      const children = Object.freeze(node.children.map((child) => {
        return requireInternalValue(
          converted.get(child),
          "PUBLIC_TREE_CHILD_CONVERSION_MISSING"
        );
      }));
      publicNode = {
        id: assigner.next(), kind: "element",
        namespaceUri: node.namespaceUri,
        prefix: node.prefix,
        localName: node.localName,
        tagName: node.name,
        attributes: toAttributes(node.attributes, captureSpans, operation),
        children, spanProvenance,
        ...(span ? { span } : {})
      };
    }
    converted.set(node, Object.freeze(publicNode));
  }

  return Object.freeze(nodes.map((node) => {
    return requireInternalValue(
      converted.get(node),
      "PUBLIC_TREE_ROOT_CONVERSION_MISSING"
    );
  }));
}

function collectMetrics(nodes: readonly HtmlNode[], operation: OperationContext): NodeMetrics {
  let totalNodes = 0;
  let maxDepth = 1;

  const stack: { readonly node: HtmlNode; readonly depth: number }[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node !== undefined) {
      stack.push({ node, depth: 2 });
    }
  }
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) {
      continue;
    }
    operation.checkpoint();
    totalNodes += 1;
    maxDepth = Math.max(maxDepth, entry.depth);
    if (entry.node.kind === "element") {
      for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
        const child = entry.node.children[index];
        if (child !== undefined) {
          stack.push({ node: child, depth: entry.depth + 1 });
        }
      }
    }
  }

  return { nodes: totalNodes, maxDepth };
}

interface ParseInputContext {
  readonly inputKind: ParsedDocumentMetadata["inputKind"];
  readonly byteLength: number;
  readonly decodedUtf8ByteLength: number;
  readonly transportByteLength: number | null;
  readonly metadataEncoding: ParsedDocumentMetadata["encoding"];
  readonly encodingPrescanBytes: number;
  readonly operation: OperationContext;
  readonly decode: {
    readonly source: "input" | "sniff";
    readonly encoding: string;
    readonly sniffSource: "input" | "bom" | "transport" | "meta" | "default";
  };
  readonly stream?: {
    readonly bytesRead: number;
    readonly encodingPrescanBytes: number;
    readonly encodingPrescanLimitBytes: number;
  };
}

function stringInputContext(html: string, operation: OperationContext): ParseInputContext {
  const byteLength = utf8ByteLength(html, operation);
  return {
    inputKind: "text",
    byteLength,
    decodedUtf8ByteLength: byteLength,
    transportByteLength: null,
    metadataEncoding: {
      name: null,
      source: "already-decoded"
    },
    encodingPrescanBytes: 0,
    operation,
    decode: {
      source: "input",
      encoding: "utf-8",
      sniffSource: "input"
    }
  };
}

function parseDocumentInternal(
  html: string,
  options: ParseOptions | ParseBytesOptions | ParseStreamOptions,
  input: ParseInputContext
): ParsedDocument {
  const operation = input.operation;
  const budgets = options.budgets;
  const captureSpans = options.captureSpans ?? false;
  const assigner = new NodeIdAssigner();
  const documentId = assigner.next();
  const traceSink = new TraceSink(
    options.trace ?? "none",
    options.onTraceEvent,
    budgets,
    operation
  );

  operation.checkpoint();
  enforceBudget("maxInputBytes", budgets?.maxInputBytes, input.byteLength);
  enforceBudget(
    "maxDecodedUtf8Bytes",
    budgets?.maxDecodedUtf8Bytes,
    input.decodedUtf8ByteLength
  );
  traceSink.emit({
    kind: "decode",
    ...input.decode
  });
  if (input.stream !== undefined) {
    traceSink.emit({
      kind: "stream",
      bytesRead: input.stream.bytesRead,
      encodingPrescanBytes: input.stream.encodingPrescanBytes,
      encodingPrescanLimitBytes: input.stream.encodingPrescanLimitBytes
    });
  }
  traceSink.emitBudget(
    "maxInputBytes",
    budgets?.maxInputBytes,
    input.byteLength
  );

  let tokenCount = 0;
  let previousTokenWasCharacter = false;

  const built = buildHtmlTree(html, budgets, {
    captureSpans,
    checkpoint(): void {
      operation.checkpoint();
    },
    ...(traceSink.active
      ? {
          onToken(kind: "startTag" | "endTag" | "comment" | "doctype" | "character" | "eof"): void {
            if (kind !== "character" || !previousTokenWasCharacter) {
              tokenCount += 1;
            }
            previousTokenWasCharacter = kind === "character";
          },
          onInsertionModeTransition(transition: {
            readonly fromMode: string;
            readonly toMode: string;
            readonly tokenType: string | null;
            readonly tokenTagName: string | null;
            readonly tokenStartOffset: number | null;
            readonly tokenEndOffset: number | null;
          }): void {
            traceSink.emit({
              kind: "insertionModeTransition",
              fromMode: transition.fromMode,
              toMode: transition.toMode,
              tokenContext: {
                type: transition.tokenType,
                tagName: transition.tokenTagName,
                startOffset: transition.tokenStartOffset,
                endOffset: transition.tokenEndOffset
              }
            });
          },
          onParseError(error: {
            readonly code: string;
            readonly startOffset?: number;
            readonly endOffset?: number;
          }): void {
            traceSink.emit({
              kind: "parseError",
              parseErrorId: normalizeParseErrorId(error.code),
              startOffset: typeof error.startOffset === "number" ? error.startOffset : null,
              endOffset: typeof error.endOffset === "number" ? error.endOffset : null
            });
          }
        }
      : {})
  });

  traceSink.emit({
    kind: "token",
    count: tokenCount
  });

  const children = convertTreeNodes(built.document.children, assigner, captureSpans, operation);
  const metrics = collectMetrics(children, operation);
  const totalNodes = metrics.nodes + 1;

  operation.checkpoint();

  traceSink.emit({
    kind: "tree-mutation",
    nodeCount: totalNodes,
    errorCount: built.errors.length
  });
  traceSink.emitBudget("maxNodes", budgets?.maxNodes, built.resourceUsage.nodes);
  traceSink.emitBudget("maxDepth", budgets?.maxDepth, built.resourceUsage.maxDepth);

  const errors = toParseErrors(built.errors, operation);
  const trace = traceSink.finish({
    tokenCount,
    nodeCount: totalNodes,
    maxDepth: metrics.maxDepth,
    parseErrorCount: built.errors.length,
    encoding: {
      name: input.decode.encoding,
      source: input.decode.sniffSource
    },
    inputBytes: input.byteLength,
    decodedUtf8Bytes: input.decodedUtf8ByteLength,
    bytesRead: input.stream?.bytesRead ?? null,
    encodingPrescanBytes: input.stream?.encodingPrescanBytes ?? null,
    encodingPrescanLimitBytes: input.stream?.encodingPrescanLimitBytes ?? null
  });

  const tree: DocumentTree = Object.freeze({
    id: documentId,
    kind: "document",
    children,
    errors,
    ...(trace === undefined ? {} : { trace })
  });
  const resourceUsage: ParseResourceUsage = Object.freeze({
    inputBytes: input.byteLength,
    decodedUtf8Bytes: input.decodedUtf8ByteLength,
    decodedCodeUnits: html.length,
    nodes: built.resourceUsage.nodes,
    maxDepth: built.resourceUsage.maxDepth,
    parseErrors: built.resourceUsage.parseErrors,
    attributes: built.resourceUsage.attributes,
    attributeUtf8Bytes: built.resourceUsage.attributeUtf8Bytes,
    encodingPrescanBytes: input.encodingPrescanBytes,
    traceEvents: traceSink.eventCount,
    traceUtf8Bytes: traceSink.eventUtf8Bytes
  });
  const metadata: ParsedDocumentMetadata = Object.freeze({
    inputKind: input.inputKind,
    transportByteLength: input.transportByteLength,
    encoding: Object.freeze({ ...input.metadataEncoding }),
    resourceUsage
  });
  const sourceText = options.sourceRetention === "text" ? html : null;
  const result: ParsedDocument = Object.freeze({
    tree,
    sourceText,
    metadata
  });
  parsedDocumentSources.set(result, sourceText);
  parsedDocumentSpans.set(result, captureSpans);
  return result;
}/**
 * Parses input deterministically for the `parse` public API.
 */


export function parse(html: string, options: ParseOptions = {}): ParsedDocument {
  const startedAt = performance.now();
  const normalizedOptions = normalizeParseOptions(options);
  requireString(html, "input");
  const operation = parseOperationContext(normalizedOptions, startedAt);
  operation.checkpoint();
  const input = stringInputContext(html, operation);
  operation.checkpoint();
  return parseDocumentInternal(html, normalizedOptions, input);
}/**
 * Parses input deterministically for the `parseBytes` public API.
 */


export function parseBytes(bytes: Uint8Array, options: ParseBytesOptions = {}): ParsedDocument {
  const startedAt = performance.now();
  const normalizedOptions = normalizeParseBytesOptions(options);
  requireByteArray(bytes, "input");
  const operation = parseOperationContext(normalizedOptions, startedAt);
  operation.checkpoint();
  enforceBudget("maxInputBytes", normalizedOptions.budgets?.maxInputBytes, bytes.byteLength);

  const decodedBudget = new DecodedUtf8BudgetCounter(
    normalizedOptions.budgets?.maxDecodedUtf8Bytes,
    operation
  );

  const decoded = decodeHtmlBytes(
    bytes,
    {
      ...(normalizedOptions.transportEncodingLabel
        ? { transportEncodingLabel: normalizedOptions.transportEncodingLabel }
        : {}),
      onDecodedChunk(chunk): void {
        decodedBudget.append(chunk);
      }
    }
  );
  operation.checkpoint();

  return parseDocumentInternal(decoded.text, normalizedOptions, {
    inputKind: "bytes",
    byteLength: bytes.byteLength,
    decodedUtf8ByteLength: decodedBudget.bytes,
    transportByteLength: bytes.byteLength,
    metadataEncoding: {
      name: decoded.sniff.encoding,
      source: decoded.sniff.source
    },
    encodingPrescanBytes: 0,
    operation,
    decode: {
      source: "sniff",
      encoding: decoded.sniff.encoding,
      sniffSource: decoded.sniff.source
    }
  });
}/**
 * Parses input deterministically for the `parseFragment` public API.
 */


export function parseFragment(
  html: string,
  contextTagName: string,
  options: ParseFragmentOptions = {}
): FragmentTree {
  const startedAt = performance.now();
  const normalizedOptions = normalizeParseFragmentOptions(options);
  requireString(html, "input");
  requireString(contextTagName, "contextTagName");
  const budgets = normalizedOptions.budgets;
  const captureSpans = normalizedOptions.captureSpans ?? false;
  const normalizedContext = contextTagName.trim().toLowerCase();

  if (normalizedContext.length === 0) {
    throw new HtmlConfigurationError(
      "contextTagName",
      "INVALID_VALUE",
      "must be a non-empty tag name"
    );
  }

  const operation = parseOperationContext(normalizedOptions, startedAt);
  operation.checkpoint();

  const inputByteLength = utf8ByteLength(html, operation);
  enforceBudget("maxInputBytes", budgets?.maxInputBytes, inputByteLength);
  enforceBudget("maxDecodedUtf8Bytes", budgets?.maxDecodedUtf8Bytes, inputByteLength);

  const assigner = new NodeIdAssigner();
  const fragmentId = assigner.next();
  const traceSink = new TraceSink(
    normalizedOptions.trace ?? "none",
    normalizedOptions.onTraceEvent,
    budgets,
    operation
  );

  traceSink.emit({
    kind: "decode",
    source: "input",
    encoding: "utf-8",
    sniffSource: "input"
  });
  traceSink.emitBudget(
    "maxInputBytes",
    budgets?.maxInputBytes,
    inputByteLength
  );

  let tokenCount = 0;
  let previousTokenWasCharacter = false;

  const built = buildHtmlTree(html, budgets, {
    fragmentContextTagName: normalizedContext,
    captureSpans,
    checkpoint(): void {
      operation.checkpoint();
    },
    ...(traceSink.active
      ? {
          onToken(kind: "startTag" | "endTag" | "comment" | "doctype" | "character" | "eof"): void {
            if (kind !== "character" || !previousTokenWasCharacter) {
              tokenCount += 1;
            }
            previousTokenWasCharacter = kind === "character";
          },
          onInsertionModeTransition(transition: {
            readonly fromMode: string;
            readonly toMode: string;
            readonly tokenType: string | null;
            readonly tokenTagName: string | null;
            readonly tokenStartOffset: number | null;
            readonly tokenEndOffset: number | null;
          }): void {
            traceSink.emit({
              kind: "insertionModeTransition",
              fromMode: transition.fromMode,
              toMode: transition.toMode,
              tokenContext: {
                type: transition.tokenType,
                tagName: transition.tokenTagName,
                startOffset: transition.tokenStartOffset,
                endOffset: transition.tokenEndOffset
              }
            });
          },
          onParseError(error: {
            readonly code: string;
            readonly startOffset?: number;
            readonly endOffset?: number;
          }): void {
            traceSink.emit({
              kind: "parseError",
              parseErrorId: normalizeParseErrorId(error.code),
              startOffset: typeof error.startOffset === "number" ? error.startOffset : null,
              endOffset: typeof error.endOffset === "number" ? error.endOffset : null
            });
          }
        }
      : {})
  });

  traceSink.emit({
    kind: "token",
    count: tokenCount
  });

  const children = convertTreeNodes(built.document.children, assigner, captureSpans, operation);
  const metrics = collectMetrics(children, operation);
  const totalNodes = metrics.nodes + 1;

  operation.checkpoint();

  traceSink.emit({
    kind: "tree-mutation",
    nodeCount: totalNodes,
    errorCount: built.errors.length
  });
  traceSink.emitBudget("maxNodes", budgets?.maxNodes, built.resourceUsage.nodes);
  traceSink.emitBudget("maxDepth", budgets?.maxDepth, built.resourceUsage.maxDepth);

  const errors = toParseErrors(built.errors, operation);
  const trace = traceSink.finish({
    tokenCount,
    nodeCount: totalNodes,
    maxDepth: metrics.maxDepth,
    parseErrorCount: built.errors.length,
    encoding: { name: "utf-8", source: "input" },
    inputBytes: inputByteLength,
    decodedUtf8Bytes: inputByteLength,
    bytesRead: null,
    encodingPrescanBytes: null,
    encodingPrescanLimitBytes: null
  });

  return Object.freeze({
    id: fragmentId,
    kind: "fragment",
    contextTagName: normalizedContext,
    children,
    errors,
    ...(trace === undefined ? {} : { trace })
  });
}

interface StreamDecodeResult {
  readonly text: string;
  readonly sniff: StreamEncodingSniff;
  readonly totalBytes: number;
  readonly decodedUtf8Bytes: number;
  readonly encodingPrescanBytes: number;
  readonly encodingPrescanLimitBytes: number;
}

interface StreamEncodingSniff {
  readonly encoding: string;
  readonly source: "bom" | "transport" | "meta" | "default";
}

interface StreamDecoderState {
  readonly decoder: TextDecoder;
  readonly sniff: StreamEncodingSniff;
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  operation: OperationContext
): Promise<ReadableStreamReadResult<Uint8Array>> {
  operation.checkpoint();
  let readPromise: Promise<ReadableStreamReadResult<Uint8Array>>;
  try {
    readPromise = reader.read();
  } catch (cause) {
    throw new HtmlStreamReadError(cause);
  }

  const signal = operation.signal;
  const remainingTimeMs = operation.remainingTimeMs();
  if (!signal && remainingTimeMs === undefined) {
    try {
      return await readPromise;
    } catch (cause) {
      throw new HtmlStreamReadError(cause);
    }
  }

  let abortListener: (() => void) | undefined;
  const abortPromise = signal
    ? new Promise<never>((_resolve, reject) => {
        abortListener = () => {
          reject(new HtmlAbortError(signal.reason));
        };
        signal.addEventListener("abort", abortListener, { once: true });
        if (signal.aborted) {
          abortListener();
        }
      })
    : undefined;
  let deadlineTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const deadlinePromise = remainingTimeMs === undefined
    ? undefined
    : new Promise<never>((_resolve, reject) => {
        deadlineTimer = globalThis.setTimeout(() => {
          const limit = operation.timeLimit ?? 0;
          reject(new HtmlBudgetExceededError("maxTimeMs", limit, limit + 1));
        }, Math.ceil(remainingTimeMs));
      });

  try {
    return await Promise.race([
      readPromise,
      ...(abortPromise ? [abortPromise] : []),
      ...(deadlinePromise ? [deadlinePromise] : [])
    ]);
  } catch (cause) {
    if (cause instanceof HtmlAbortError || cause instanceof HtmlBudgetExceededError) {
      throw cause;
    }
    throw new HtmlStreamReadError(cause);
  } finally {
    if (abortListener) {
      signal?.removeEventListener("abort", abortListener);
    }
    if (deadlineTimer !== undefined) {
      globalThis.clearTimeout(deadlineTimer);
    }
  }
}

async function decodeStreamToText(
  stream: ReadableStream<Uint8Array>,
  options: {
    readonly transportEncodingLabel?: string;
    readonly budgets?: ParseStreamBudgetOptions | TokenizeByteStreamEagerOptions["budgets"];
  },
  operation: OperationContext
): Promise<StreamDecodeResult> {
  const budgets = options.budgets;
  operation.checkpoint();
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = stream.getReader();
  } catch (cause) {
    throw new HtmlStreamReadError(cause);
  }
  let total = 0;
  const prescanLimit = Math.min(
    DEFAULT_STREAM_ENCODING_PRESCAN_BYTES,
    budgets?.maxEncodingPrescanBytes ?? DEFAULT_STREAM_ENCODING_PRESCAN_BYTES
  );
  const pendingBytesBuffer = new Uint8Array(prescanLimit);
  let pendingBytes = 0;
  let encodingPrescanBytes = 0;
  let decoderState: StreamDecoderState | undefined;
  const decodedParts: string[] = [];
  const decodedBudget = new DecodedUtf8BudgetCounter(
    budgets?.maxDecodedUtf8Bytes,
    operation
  );
  const sniffOptions =
    options.transportEncodingLabel === undefined
      ? { maxPrescanBytes: prescanLimit }
      : {
          transportEncodingLabel: options.transportEncodingLabel,
          maxPrescanBytes: prescanLimit
        };

  const appendDecoded = (value: string): void => {
    if (value.length > 0) {
      decodedBudget.append(value);
      decodedParts.push(value);
    }
  };

  const decodeBytes = (decoder: TextDecoder, bytes: Uint8Array): void => {
    const decodeChunkBytes = 16_384;
    for (let offset = 0; offset < bytes.byteLength; offset += decodeChunkBytes) {
      operation.checkpoint();
      appendDecoded(
        decoder.decode(bytes.subarray(offset, offset + decodeChunkBytes), { stream: true })
      );
    }
  };

  const initializeDecoder = (): StreamDecoderState => {
    const bufferedBytes = pendingBytesBuffer.subarray(0, pendingBytes);
    const sniff = sniffHtmlEncoding(bufferedBytes, sniffOptions);
    const state = {
      decoder: new TextDecoder(sniff.encoding),
      sniff
    };
    decoderState = state;
    decodeBytes(state.decoder, bufferedBytes);
    return state;
  };

  try {
    if (prescanLimit === 0) {
      initializeDecoder();
    }

    for (;;) {
      const next = await readStreamChunk(reader, operation);
      if (next.done) {
        break;
      }

      const chunkValue = next.value;
      if (!(chunkValue instanceof Uint8Array)) {
        throw new HtmlStreamReadError(
          new TypeError("HTML byte stream yielded a non-Uint8Array chunk")
        );
      }
      total += chunkValue.byteLength;

      enforceBudget("maxInputBytes", budgets?.maxInputBytes, total);
      operation.checkpoint();

      if (decoderState === undefined) {
        const bytesToBuffer = Math.min(chunkValue.byteLength, prescanLimit - pendingBytes);
        pendingBytesBuffer.set(chunkValue.subarray(0, bytesToBuffer), pendingBytes);
        pendingBytes += bytesToBuffer;
        encodingPrescanBytes = Math.max(encodingPrescanBytes, pendingBytes);
        if (pendingBytes < prescanLimit) {
          continue;
        }

        const activeDecoder = initializeDecoder().decoder;
        if (bytesToBuffer < chunkValue.byteLength) {
          decodeBytes(activeDecoder, chunkValue.subarray(bytesToBuffer));
        }
        continue;
      }

      decodeBytes(decoderState.decoder, chunkValue);
    }

    const finalState = decoderState ?? initializeDecoder();
    appendDecoded(finalState.decoder.decode());

    return {
      text: decodedParts.join(""),
      sniff: finalState.sniff,
      totalBytes: total,
      decodedUtf8Bytes: decodedBudget.bytes,
      encodingPrescanBytes,
      encodingPrescanLimitBytes: prescanLimit
    };
  } catch (error) {
    try {
      const cancellation = reader.cancel(error);
      void cancellation.catch(() => {
        // Cleanup failures never replace or delay the original operation failure.
      });
    } catch {
      // Preserve the original read, decode, or budget failure.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}/**
 * Tokenizes input deterministically for the `tokenizeByteStreamEager` public API.
 */


async function tokenizeDecodedByteStreamEager(
  stream: ReadableStream<Uint8Array>,
  options: TokenizeByteStreamEagerOptions,
  operation: OperationContext
): Promise<readonly Token[]> {
  const decoded = await decodeStreamToText(stream, options, operation);
  let parseErrorCount = 0;
  let currentStartTagAttributeCount = 0;
  let currentStartTagAttributeBytes = 0;
  const encoder = new TextEncoder();
  const tokenized = tokenize(decoded.text, {
    checkpoint(): void {
      operation.checkpoint();
    },
    onParseError(): void {
      parseErrorCount += 1;
      enforceBudget("maxParseErrors", options.budgets?.maxParseErrors, parseErrorCount);
    },
    onStartTagOpen(): void {
      currentStartTagAttributeCount = 0;
      currentStartTagAttributeBytes = 0;
    },
    onStartTagAttribute(value, start): void {
      operation.checkpoint();
      if (start) {
        currentStartTagAttributeCount += 1;
        enforceBudget(
          "maxAttributesPerElement",
          options.budgets?.maxAttributesPerElement,
          currentStartTagAttributeCount
        );
      }
      currentStartTagAttributeBytes += encoder.encode(value).byteLength;
      enforceBudget(
        "maxAttributeBytes",
        options.budgets?.maxAttributeBytes,
        currentStartTagAttributeBytes
      );
    },
    onStartTag(attributes): void {
      enforceTokenAttributeBudgets(attributes, options.budgets);
    }
  });
  operation.checkpoint();

  const tokens: Token[] = [];
  for (const token of tokenized.tokens) {
    operation.checkpoint();
    tokens.push(toToken(token));
  }
  return tokens;
}

/**
 * Eagerly reads, decodes, and tokenizes a complete byte stream. The returned
 * promise resolves to one token collection after EOF and reader release.
 */
export async function tokenizeByteStreamEager(
  stream: ReadableStream<Uint8Array>,
  options: TokenizeByteStreamEagerOptions = {}
): Promise<readonly Token[]> {
  const startedAt = performance.now();
  const normalizedOptions = normalizeTokenizeByteStreamEagerOptions(options);
  requireReadableByteStream(stream, "input");
  const operation = createOperationContext(
    normalizedOptions.budgets?.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  return tokenizeDecodedByteStreamEager(stream, normalizedOptions, operation);
}/**
 * Reads and decodes a byte stream through EOF, releases its reader, and then
 * parses the buffered document deterministically.
 */


export async function parseStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseStreamOptions = {}
): Promise<ParsedDocument> {
  const startedAt = performance.now();
  const normalizedOptions = normalizeParseStreamOptions(options);
  requireReadableByteStream(stream, "input");
  const operation = parseOperationContext(normalizedOptions, startedAt);
  operation.checkpoint();
  const decoded = await decodeStreamToText(stream, normalizedOptions, operation);
  return parseDocumentInternal(decoded.text, normalizedOptions, {
    inputKind: "stream",
    byteLength: decoded.totalBytes,
    decodedUtf8ByteLength: decoded.decodedUtf8Bytes,
    transportByteLength: decoded.totalBytes,
    metadataEncoding: {
      name: decoded.sniff.encoding,
      source: decoded.sniff.source
    },
    encodingPrescanBytes: decoded.encodingPrescanBytes,
    operation,
    decode: {
      source: "sniff",
      encoding: decoded.sniff.encoding,
      sniffSource: decoded.sniff.source
    },
    stream: {
      bytesRead: decoded.totalBytes,
      encodingPrescanBytes: decoded.encodingPrescanBytes,
      encodingPrescanLimitBytes: decoded.encodingPrescanLimitBytes
    }
  });
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function quoteDoctypeIdentifier(value: string): string {
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  throw new HtmlConfigurationError(
    "tree",
    "INVALID_VALUE",
    "DOCTYPE identifiers containing both quote characters cannot be serialized losslessly"
  );
}

function serializeDoctype(node: Extract<HtmlNode, { kind: "doctype" }>): string {
  if (node.externalId.kind === "none") {
    return `<!DOCTYPE ${node.name}>`;
  }
  if (node.externalId.kind === "system") {
    return `<!DOCTYPE ${node.name} SYSTEM ${quoteDoctypeIdentifier(node.externalId.systemId)}>`;
  }
  const systemId = node.externalId.systemId === null
    ? ""
    : ` ${quoteDoctypeIdentifier(node.externalId.systemId)}`;
  return `<!DOCTYPE ${node.name} PUBLIC ${quoteDoctypeIdentifier(node.externalId.publicId)}${systemId}>`;
}

function serializeNodes(nodes: readonly HtmlNode[], operation: OperationContext): string {
  type Action = { readonly kind: "node"; readonly node: HtmlNode } |
    { readonly kind: "text"; readonly value: string };
  const parts: string[] = [];
  const stack: Action[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node !== undefined) {
      stack.push({ kind: "node", node });
    }
  }
  while (stack.length > 0) {
    const action = stack.pop();
    if (action === undefined) {
      continue;
    }
    operation.checkpoint();
    if (action.kind === "text") {
      parts.push(action.value);
      continue;
    }
    const node = action.node;
    if (node.kind === "text") {
      parts.push(escapeText(node.value));
    } else if (node.kind === "comment") {
      parts.push(`<!--${node.value}-->`);
    } else if (node.kind === "doctype") {
      parts.push(serializeDoctype(node));
    } else {
      const attributes = node.attributes
        .map((entry) => `${entry.name}="${escapeAttribute(entry.value)}"`)
        .join(" ");
      const open = attributes.length > 0
        ? `<${node.tagName} ${attributes}>`
        : `<${node.tagName}>`;
      parts.push(open);
      const isHtmlVoid = node.namespaceUri === HTML_NAMESPACE_URI &&
        VOID_ELEMENTS.has(asciiLowercase(node.localName));
      if (!isHtmlVoid) {
        stack.push({ kind: "text", value: `</${node.tagName}>` });
        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          const child = node.children[index];
          if (child !== undefined) {
            stack.push({ kind: "node", node: child });
          }
        }
      }
    }
  }
  return parts.join("");
}/**
 * Serializes data deterministically for the `serialize` public API.
 */


export function serialize(
  tree: DocumentTree | FragmentTree | HtmlNode,
  options: OperationOptions = {}
): string {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  if (tree.kind === "document" || tree.kind === "fragment") {
    return serializeNodes(tree.children, operation);
  }

  return serializeNodes([tree], operation);
}

const VISIBLE_TEXT_SKIP_TAGS = new Set(["head", "script", "style", "template", "title", "optgroup", "option"]);
const VISIBLE_TEXT_INPUT_VALUE_TAG_TYPES = new Set(["button", "submit", "reset"]);
const VISIBLE_TEXT_BLOCK_BREAK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "nav",
  "ol",
  "section",
  "table",
  "tbody",
  "thead",
  "tfoot",
  "ul"
]);

type VisibleTextPolicyOptions = Required<
  Pick<
    VisibleTextExtractionOptions,
    "skipHiddenSubtrees" | "includeControlValues" | "includeAccessibleNameFallback" | "trim"
  >
>;

type ResolvedVisibleTextOptions = VisibleTextPolicyOptions & {
  readonly operation: OperationContext;
  readonly maxFallbackInputBytes: number;
  readonly maxFallbackNodes: number;
};

const DEFAULT_VISIBLE_TEXT_OPTIONS: VisibleTextPolicyOptions = Object.freeze({
  skipHiddenSubtrees: true,
  includeControlValues: true,
  includeAccessibleNameFallback: false,
  trim: true
});

function normalizeBooleanAttribute(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "true" || normalized === "1";
}

/** Returns an unnamespaced HTML attribute value using ASCII case-insensitive matching. */
export function getAttributeValue(
  node: Extract<HtmlNode, { kind: "element" }>,
  name: string
): string | undefined {
  if (node.namespaceUri !== HTML_NAMESPACE_URI) {
    return undefined;
  }
  const target = asciiLowercase(name);
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === null && asciiLowercase(attribute.localName) === target) {
      return attribute.value;
    }
  }
  return undefined;
}

/** Tests for an unnamespaced HTML attribute using ASCII case-insensitive matching. */
export function hasAttribute(
  node: Extract<HtmlNode, { kind: "element" }>,
  name: string
): boolean {
  return getAttributeValue(node, name) !== undefined;
}

/** Returns an attribute value by exact namespace URI and local name. */
export function getAttributeValueNS(
  node: Extract<HtmlNode, { kind: "element" }>,
  namespaceUri: string | null,
  localName: string
): string | undefined {
  return node.attributes.find((attribute) =>
    attribute.namespaceUri === namespaceUri && attribute.localName === localName
  )?.value;
}

/** Tests for an attribute by exact namespace URI and local name. */
export function hasAttributeNS(
  node: Extract<HtmlNode, { kind: "element" }>,
  namespaceUri: string | null,
  localName: string
): boolean {
  return getAttributeValueNS(node, namespaceUri, localName) !== undefined;
}

function attributeValue(node: Extract<HtmlNode, { kind: "element" }>, name: string): string | undefined {
  return node.namespaceUri === HTML_NAMESPACE_URI
    ? getAttributeValue(node, name)
    : getAttributeValueNS(node, null, name);
}

function shouldSkipHiddenSubtree(
  node: Extract<HtmlNode, { kind: "element" }>,
  options: ResolvedVisibleTextOptions
): boolean {
  options.operation.checkpoint();
  if (!options.skipHiddenSubtrees) {
    return false;
  }
  if (attributeValue(node, "hidden") !== undefined) {
    return true;
  }
  const inlineStyle = attributeValue(node, "style");
  if (inlineStyle) {
    const normalizedStyle = inlineStyle.toLowerCase().replace(/\s+/g, "");
    if (
      normalizedStyle.includes("display:none")
      || normalizedStyle.includes("visibility:hidden")
      || normalizedStyle.includes("content-visibility:hidden")
    ) {
      return true;
    }
  }
  return normalizeBooleanAttribute(attributeValue(node, "aria-hidden"));
}

function nonEmptyAttributeValue(
  node: Extract<HtmlNode, { kind: "element" }>,
  name: string
): string | undefined {
  const value = attributeValue(node, name);
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function accessibleNameFallback(
  node: Extract<HtmlNode, { kind: "element" }>,
  options: ResolvedVisibleTextOptions
): string | undefined {
  options.operation.checkpoint();
  if (!options.includeAccessibleNameFallback) {
    return undefined;
  }
  const tagName = node.tagName.toLowerCase();
  if (tagName !== "input") {
    return undefined;
  }
  const type = (attributeValue(node, "type") ?? "text").trim().toLowerCase();
  if (type === "hidden") {
    return undefined;
  }
  return nonEmptyAttributeValue(node, "aria-label");
}

interface ExtractionSourceMeta {
  readonly sourceNodeId: NodeId | null;
  readonly sourceNodeKind: TextExtractionSourceNodeKind;
  readonly sourceRole: TextExtractionSourceRole;
}

interface ExtractionSourceChunk {
  readonly value: string;
  readonly normalizeSegment: boolean;
  readonly preserveWhitespace: boolean;
  readonly source: ExtractionSourceMeta;
}

function extractionSourceMetaFromNode(
  node: HtmlNode | DocumentTree | FragmentTree,
  sourceRole: TextExtractionSourceRole
): ExtractionSourceMeta {
  return {
    sourceNodeId: node.id,
    sourceNodeKind: node.kind,
    sourceRole
  };
}

function sameExtractionSource(left: ExtractionSourceMeta, right: ExtractionSourceMeta): boolean {
  return left.sourceNodeId === right.sourceNodeId &&
    left.sourceNodeKind === right.sourceNodeKind &&
    left.sourceRole === right.sourceRole;
}

function codePointUtf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

function scalarUtf8ByteLength(value: string): number {
  const codePoint = value.codePointAt(0);
  return codePoint === undefined ? 0 : codePointUtf8ByteLength(codePoint);
}

function* iterateStringScalars(
  value: string,
  operation: OperationContext
): IterableIterator<string> {
  let cursor = 0;
  while (cursor < value.length) {
    operation.checkpoint();
    const codePoint = value.codePointAt(cursor);
    if (codePoint === undefined) {
      break;
    }
    const width = codePoint > 0xffff ? 2 : 1;
    yield value.slice(cursor, cursor + width);
    cursor += width;
  }
}

function* iterateNormalizedSegmentScalars(
  value: string,
  preserveWhitespace: boolean,
  operation: OperationContext
): IterableIterator<string> {
  let cursor = 0;
  let inAsciiWhitespace = false;
  while (cursor < value.length) {
    operation.checkpoint();
    const codePoint = value.codePointAt(cursor);
    if (codePoint === undefined) {
      break;
    }
    const width = codePoint > 0xffff ? 2 : 1;
    const scalar = value.slice(cursor, cursor + width);
    cursor += width;

    if (preserveWhitespace) {
      if (scalar === "\r") {
        if (value[cursor] === "\n") {
          cursor += 1;
        }
        yield "\n";
      } else {
        yield scalar;
      }
      continue;
    }

    const asciiWhitespace = scalar === " " || scalar === "\t" ||
      scalar === "\n" || scalar === "\f" || scalar === "\r";
    if (asciiWhitespace) {
      if (!inAsciiWhitespace) {
        yield " ";
        inAsciiWhitespace = true;
      }
      continue;
    }
    inAsciiWhitespace = false;
    yield scalar;
  }
}

interface MutableExtractionRange {
  outputByteStart: number;
  outputByteEnd: number;
  readonly source: ExtractionSourceMeta;
}

class BoundedTextCollector {
  readonly #policy: TextExtractionPolicy;
  readonly #maxOutputBytes: number;
  readonly #maxTokens: number;
  #totalBytes = 0;
  #retainedBytes = 0;
  #retainedTokens = 0;
  #truncated = false;
  #sealed = false;
  #resultParts: string[] = [];
  #readyTokens: TextExtractionToken[] = [];
  #activeTextLogical = false;
  #activeTextAccepted = false;
  #activeTextChunks: string[] = [];
  #activeTextPendingParts: string[] = [];
  #activeTextStart = 0;
  #activeTextRanges: MutableExtractionRange[] = [];
  #pendingNewlineSource: ExtractionSourceMeta | null = null;
  #finished = false;

  constructor(policy: TextExtractionPolicy, maxOutputBytes: number, maxTokens: number) {
    this.#policy = policy;
    this.#maxOutputBytes = maxOutputBytes;
    this.#maxTokens = maxTokens;
  }

  consumeVisibleScalar(value: string, source: ExtractionSourceMeta): void {
    this.#observeScalar(value);
    if (value === "\n") {
      this.#finishTextToken();
      if (this.#pendingNewlineSource === null) {
        this.#pendingNewlineSource = source;
      } else {
        this.#emitAtomicToken("paragraphBreak", [
          { value: "\n", source: this.#pendingNewlineSource },
          { value: "\n", source }
        ]);
        this.#pendingNewlineSource = null;
      }
      return;
    }

    this.#finishPendingNewline();
    if (value === "\t") {
      this.#finishTextToken();
      this.#emitAtomicToken("tab", [{ value, source }]);
      return;
    }
    this.#appendTextScalar(value, source);
  }

  consumeRawScalar(value: string, source: ExtractionSourceMeta): void {
    this.#observeScalar(value);
    this.#appendTextScalar(value, source);
  }

  finishRawChunk(): void {
    this.#finishTextToken();
  }

  observeOmittedBytes(bytes: number): void {
    if (bytes === 0) {
      return;
    }
    this.#totalBytes += bytes;
    this.#sealed = true;
    this.#truncated = true;
  }

  takeReadyTokens(): readonly TextExtractionToken[] {
    if (this.#readyTokens.length === 0) {
      return [];
    }
    const ready = this.#readyTokens;
    this.#readyTokens = [];
    return ready;
  }

  finish(): TextExtractionResult {
    if (!this.#finished) {
      this.#finishPendingNewline();
      this.#finishTextToken();
      this.#finished = true;
    }
    return Object.freeze({
      text: this.#resultParts.join(""),
      totalBytes: this.#totalBytes,
      truncated: this.#truncated,
      policy: this.#policy
    });
  }

  #observeScalar(value: string): void {
    this.#totalBytes += scalarUtf8ByteLength(value);
  }

  #finishPendingNewline(): void {
    if (this.#pendingNewlineSource === null) {
      return;
    }
    this.#emitAtomicToken("lineBreak", [
      { value: "\n", source: this.#pendingNewlineSource }
    ]);
    this.#pendingNewlineSource = null;
  }

  #beginTextToken(): void {
    if (this.#activeTextLogical) {
      return;
    }
    this.#activeTextLogical = true;
    this.#activeTextAccepted = !this.#sealed && this.#retainedTokens < this.#maxTokens;
    this.#activeTextStart = this.#retainedBytes;
    if (!this.#activeTextAccepted) {
      this.#sealed = true;
      this.#truncated = true;
    }
  }

  #appendTextScalar(value: string, source: ExtractionSourceMeta): void {
    this.#beginTextToken();
    if (!this.#activeTextAccepted || this.#sealed) {
      return;
    }
    if (this.#appendRetainedScalar(
      value,
      source,
      this.#activeTextPendingParts,
      this.#activeTextRanges
    ) && this.#activeTextPendingParts.length >= 256) {
      this.#activeTextChunks.push(this.#activeTextPendingParts.join(""));
      this.#activeTextPendingParts = [];
    }
  }

  #appendRetainedScalar(
    value: string,
    source: ExtractionSourceMeta,
    parts: string[],
    ranges: MutableExtractionRange[]
  ): boolean {
    const bytes = scalarUtf8ByteLength(value);
    if (this.#retainedBytes + bytes > this.#maxOutputBytes) {
      this.#sealed = true;
      this.#truncated = true;
      return false;
    }
    const start = this.#retainedBytes;
    const end = start + bytes;
    parts.push(value);
    const previous = ranges[ranges.length - 1];
    if (
      previous !== undefined &&
      previous.outputByteEnd === start &&
      sameExtractionSource(previous.source, source)
    ) {
      previous.outputByteEnd = end;
    } else {
      ranges.push({ outputByteStart: start, outputByteEnd: end, source });
    }
    this.#retainedBytes = end;
    return true;
  }

  #finishTextToken(): void {
    if (!this.#activeTextLogical) {
      return;
    }
    if (
      this.#activeTextAccepted &&
      (this.#activeTextChunks.length > 0 || this.#activeTextPendingParts.length > 0)
    ) {
      if (this.#activeTextPendingParts.length > 0) {
        this.#activeTextChunks.push(this.#activeTextPendingParts.join(""));
      }
      this.#publishToken(
        "text",
        this.#activeTextChunks.join(""),
        this.#activeTextStart,
        this.#activeTextRanges
      );
    }
    this.#activeTextLogical = false;
    this.#activeTextAccepted = false;
    this.#activeTextChunks = [];
    this.#activeTextPendingParts = [];
    this.#activeTextRanges = [];
  }

  #emitAtomicToken(
    kind: Exclude<TextExtractionTokenKind, "text">,
    scalars: readonly { readonly value: string; readonly source: ExtractionSourceMeta }[]
  ): void {
    if (this.#sealed || this.#retainedTokens >= this.#maxTokens) {
      this.#sealed = true;
      this.#truncated = true;
      return;
    }
    const start = this.#retainedBytes;
    const parts: string[] = [];
    const ranges: MutableExtractionRange[] = [];
    for (const scalar of scalars) {
      if (!this.#appendRetainedScalar(scalar.value, scalar.source, parts, ranges)) {
        break;
      }
    }
    if (parts.length === 0) {
      return;
    }
    const value = parts.join("");
    const retainedKind = kind === "paragraphBreak" && value === "\n"
      ? "lineBreak"
      : kind;
    this.#publishToken(retainedKind, value, start, ranges);
    if (parts.length !== scalars.length) {
      this.#truncated = true;
    }
  }

  #publishToken(
    kind: TextExtractionTokenKind,
    value: string,
    outputByteStart: number,
    ranges: readonly MutableExtractionRange[]
  ): void {
    const provenance: readonly TextProvenanceRange[] = Object.freeze(
      ranges.map((range) => Object.freeze({
        outputByteStart: range.outputByteStart,
        outputByteEnd: range.outputByteEnd,
        sourceNodeId: range.source.sourceNodeId,
        sourceNodeKind: range.source.sourceNodeKind,
        sourceRole: range.source.sourceRole
      }))
    );
    const token: TextExtractionToken = Object.freeze({
      kind,
      value,
      policy: this.#policy,
      outputByteStart,
      outputByteEnd: this.#retainedBytes,
      provenance
    });
    this.#retainedTokens += 1;
    this.#resultParts.push(value);
    this.#readyTokens.push(token);
  }
}

interface PendingSourceRun {
  readonly value: string;
  readonly source: ExtractionSourceMeta;
  count: number;
}

class ExtractionSourceRunBuffer {
  readonly #maxRetainedBytes: number;
  #runs: PendingSourceRun[] = [];
  #retainedBytes = 0;
  #omittedBytes = 0;
  #lastValue: string | null = null;

  constructor(maxRetainedBytes: number) {
    this.#maxRetainedBytes = maxRetainedBytes;
  }

  get lastValue(): string | null {
    return this.#lastValue;
  }

  push(value: string, source: ExtractionSourceMeta): void {
    const bytes = scalarUtf8ByteLength(value);
    this.#lastValue = value;
    if (this.#retainedBytes + bytes > this.#maxRetainedBytes) {
      this.#omittedBytes += bytes;
      return;
    }
    const previous = this.#runs[this.#runs.length - 1];
    if (
      previous !== undefined &&
      previous.value === value &&
      sameExtractionSource(previous.source, source)
    ) {
      previous.count += 1;
    } else {
      this.#runs.push({ value, source, count: 1 });
    }
    this.#retainedBytes += bytes;
  }

  pushOmittedBytes(bytes: number): void {
    this.#omittedBytes += bytes;
  }

  clear(): void {
    this.#runs = [];
    this.#retainedBytes = 0;
    this.#omittedBytes = 0;
    this.#lastValue = null;
  }

  drain(
    visitor: (value: string, source: ExtractionSourceMeta) => void,
    omittedVisitor: (bytes: number) => void,
    operation: OperationContext
  ): void {
    const runs = this.#runs;
    const omittedBytes = this.#omittedBytes;
    this.clear();
    for (const run of runs) {
      for (let count = 0; count < run.count; count += 1) {
        operation.checkpoint();
        visitor(run.value, run.source);
      }
    }
    omittedVisitor(omittedBytes);
  }
}

function isEcmaTrimWhitespace(value: string): boolean {
  return /^\s$/u.test(value);
}

interface StreamingTextSink {
  emit(value: string, source: ExtractionSourceMeta): void;
  observeOmittedBytes(bytes: number): void;
}

class StreamingVisibleTextNormalizer {
  readonly #trim: boolean;
  readonly #operation: OperationContext;
  readonly #sink: StreamingTextSink;
  readonly #beforeNewline: ExtractionSourceRunBuffer;
  readonly #trailingWhitespace: ExtractionSourceRunBuffer;
  #lastGlobalValue: string | null = null;
  #newlineRun = 0;
  #seenNonWhitespace = false;

  constructor(
    trim: boolean,
    maxOutputBytes: number,
    operation: OperationContext,
    sink: StreamingTextSink
  ) {
    this.#trim = trim;
    this.#beforeNewline = new ExtractionSourceRunBuffer(maxOutputBytes);
    this.#trailingWhitespace = new ExtractionSourceRunBuffer(maxOutputBytes);
    this.#operation = operation;
    this.#sink = sink;
  }

  consume(value: string, source: ExtractionSourceMeta): void {
    this.#operation.checkpoint();
    if (value === "\n") {
      this.#beforeNewline.clear();
      this.#emitGlobal(value, source);
      return;
    }
    if (value === " " || value === "\t" || value === "\f") {
      if (this.#lastGlobalValue !== "\n") {
        const previous = this.#beforeNewline.lastValue ?? this.#lastGlobalValue;
        if ((value !== " " && value !== "\t") || previous !== value) {
          this.#beforeNewline.push(value, source);
        }
      }
      return;
    }
    this.#flushBeforeNewline();
    this.#emitGlobal(value, source);
  }

  finish(): void {
    this.#flushBeforeNewline();
    this.#trailingWhitespace.clear();
  }

  #flushBeforeNewline(): void {
    this.#beforeNewline.drain(
      (value, source) => {
        this.#emitGlobal(value, source);
      },
      (bytes) => {
        this.#emitOmittedWhitespace(bytes);
      },
      this.#operation
    );
  }

  #emitOmittedWhitespace(bytes: number): void {
    if (bytes === 0 || (this.#trim && !this.#seenNonWhitespace)) {
      return;
    }
    if (this.#trim) {
      this.#trailingWhitespace.pushOmittedBytes(bytes);
    } else {
      this.#sink.observeOmittedBytes(bytes);
    }
  }

  #emitGlobal(value: string, source: ExtractionSourceMeta): void {
    if ((value === " " || value === "\t") && this.#lastGlobalValue === value) {
      return;
    }
    if (value === "\n") {
      if (this.#newlineRun >= 2) {
        return;
      }
      this.#newlineRun += 1;
    } else {
      this.#newlineRun = 0;
    }
    this.#lastGlobalValue = value;
    this.#emitTrimmed(value, source);
  }

  #emitTrimmed(value: string, source: ExtractionSourceMeta): void {
    if (!this.#trim) {
      this.#sink.emit(value, source);
      return;
    }
    if (isEcmaTrimWhitespace(value)) {
      if (this.#seenNonWhitespace) {
        this.#trailingWhitespace.push(value, source);
      }
      return;
    }
    if (this.#seenNonWhitespace) {
      this.#trailingWhitespace.drain(
        (pendingValue, pendingSource) => {
          this.#sink.emit(pendingValue, pendingSource);
        },
        (bytes) => {
          this.#sink.observeOmittedBytes(bytes);
        },
        this.#operation
      );
    }
    this.#seenNonWhitespace = true;
    this.#sink.emit(value, source);
  }
}

function boundedNoscriptFallbackChildren(
  node: Extract<HtmlNode, { kind: "element" }>,
  options: ResolvedVisibleTextOptions
): readonly HtmlNode[] | null {
  options.operation.checkpoint();
  if (!isHtmlElement(node) || asciiLowercase(node.localName) !== "noscript") {
    return null;
  }
  if (node.children.length !== 1) {
    return null;
  }
  const onlyChild = node.children[0];
  if (!onlyChild || onlyChild.kind !== "text") {
    return null;
  }
  const rawMarkup = onlyChild.value;
  if (!rawMarkup.includes("<") || !rawMarkup.includes(">")) {
    return null;
  }

  const fallbackBytes = utf8ByteLength(rawMarkup, options.operation);
  enforceBudget("maxFallbackInputBytes", options.maxFallbackInputBytes, fallbackBytes);
  const remainingTimeMs = options.operation.remainingTimeMs();
  let fallbackFragment: FragmentTree;
  try {
    fallbackFragment = parseFragment(rawMarkup, "body", {
      ...(options.operation.signal === undefined ? {} : { signal: options.operation.signal }),
      budgets: {
        maxNodes: options.maxFallbackNodes,
        ...(remainingTimeMs === undefined ? {} : { maxTimeMs: Math.floor(remainingTimeMs) })
      }
    });
  } catch (error) {
    if (isHtmlBudgetExceededError(error) && error.budget === "maxNodes") {
      throw new HtmlBudgetExceededError(
        "maxFallbackNodes",
        options.maxFallbackNodes,
        options.maxFallbackNodes + 1
      );
    }
    throw error;
  }
  options.operation.checkpoint();
  return fallbackFragment.children;
}

function* iterateVisibleExtractionChunks(
  roots: readonly HtmlNode[],
  options: ResolvedVisibleTextOptions
): IterableIterator<ExtractionSourceChunk> {
  type VisitAction = {
    readonly kind: "visit";
    readonly node: HtmlNode;
    readonly preserveWhitespace: boolean;
    readonly sourceOverride: ExtractionSourceMeta | null;
  };
  type AppendAction = {
    readonly kind: "append";
    readonly node: HtmlNode;
    readonly value: string;
    readonly sourceRole: TextExtractionSourceRole;
    readonly normalizeSegment: boolean;
    readonly preserveWhitespace: boolean;
    readonly sourceOverride: ExtractionSourceMeta | null;
  };
  type Action = VisitAction | AppendAction;
  const stack: Action[] = [];
  const pushVisits = (
    nodes: readonly HtmlNode[],
    preserveWhitespace: boolean,
    sourceOverride: ExtractionSourceMeta | null
  ): void => {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (node !== undefined) {
        stack.push({ kind: "visit", node, preserveWhitespace, sourceOverride });
      }
    }
  };
  const pushAppend = (
    node: HtmlNode,
    value: string,
    sourceRole: TextExtractionSourceRole,
    normalizeSegment: boolean,
    preserveWhitespace: boolean,
    sourceOverride: ExtractionSourceMeta | null
  ): void => {
    stack.push({
      kind: "append",
      node,
      value,
      sourceRole,
      normalizeSegment,
      preserveWhitespace,
      sourceOverride
    });
  };
  pushVisits(roots, false, null);

  while (stack.length > 0) {
    const action = stack.pop();
    if (action === undefined) {
      continue;
    }
    options.operation.checkpoint();
    if (action.kind === "append") {
      if (action.value.length > 0) {
        yield {
          value: action.value,
          normalizeSegment: action.normalizeSegment,
          preserveWhitespace: action.preserveWhitespace,
          source: action.sourceOverride ?? extractionSourceMetaFromNode(action.node, action.sourceRole)
        };
      }
      continue;
    }

    const { node, preserveWhitespace, sourceOverride } = action;
    if (node.kind === "text") {
      pushAppend(
        node,
        node.value,
        sourceOverride?.sourceRole ?? "text-node",
        true,
        preserveWhitespace,
        sourceOverride
      );
      continue;
    }
    if (node.kind !== "element" || shouldSkipHiddenSubtree(node, options)) {
      continue;
    }
    const tagName = node.tagName.toLowerCase();
    if (VISIBLE_TEXT_SKIP_TAGS.has(tagName)) {
      continue;
    }
    const fallbackChildren = boundedNoscriptFallbackChildren(node, options);
    if (fallbackChildren !== null) {
      pushVisits(fallbackChildren, preserveWhitespace, {
        sourceNodeId: node.id,
        sourceNodeKind: node.kind,
        sourceRole: "noscript-fallback"
      });
      continue;
    }
    const structuralRole = sourceOverride?.sourceRole ?? "structure-break";
    if (tagName === "br") {
      pushAppend(node, "\n", structuralRole, false, true, sourceOverride);
      continue;
    }
    if (tagName === "img" && options.includeControlValues) {
      const alt = attributeValue(node, "alt");
      if (alt && alt.length > 0) {
        pushAppend(
          node,
          alt,
          sourceOverride?.sourceRole ?? "img-alt",
          true,
          false,
          sourceOverride
        );
      }
      continue;
    }
    if (tagName === "input" && options.includeControlValues) {
      const type = (attributeValue(node, "type") ?? "text").toLowerCase();
      if (type !== "hidden") {
        const value = attributeValue(node, "value");
        if (VISIBLE_TEXT_INPUT_VALUE_TAG_TYPES.has(type) && value && value.length > 0) {
          pushAppend(
            node,
            value,
            sourceOverride?.sourceRole ?? "input-value",
            true,
            false,
            sourceOverride
          );
        } else {
          const fallbackName = accessibleNameFallback(node, options);
          if (fallbackName) {
            pushAppend(
              node,
              fallbackName,
              sourceOverride?.sourceRole ?? "input-aria-label",
              true,
              false,
              sourceOverride
            );
          }
        }
      }
      continue;
    }
    if (tagName === "select") {
      continue;
    }
    if (tagName === "button" && options.includeControlValues) {
      const value = attributeValue(node, "value");
      if (value && value.length > 0) {
        pushAppend(
          node,
          value,
          sourceOverride?.sourceRole ?? "button-value",
          true,
          false,
          sourceOverride
        );
        continue;
      }
    }
    if (tagName === "tr") {
      const actions: Action[] = [];
      actions.push({
        kind: "append",
        node,
        value: "\n",
        sourceRole: structuralRole,
        normalizeSegment: false,
        preserveWhitespace: true,
        sourceOverride
      });
      let seenTableCell = false;
      for (const child of node.children) {
        const childTagName = child.kind === "element" ? child.tagName.toLowerCase() : "";
        if ((childTagName === "td" || childTagName === "th") && seenTableCell) {
          actions.push({
            kind: "append",
            node,
            value: "\t",
            sourceRole: structuralRole,
            normalizeSegment: false,
            preserveWhitespace: true,
            sourceOverride
          });
        }
        actions.push({ kind: "visit", node: child, preserveWhitespace, sourceOverride });
        if (childTagName === "td" || childTagName === "th") {
          seenTableCell = true;
        }
      }
      actions.push({
        kind: "append",
        node,
        value: "\n",
        sourceRole: structuralRole,
        normalizeSegment: false,
        preserveWhitespace: true,
        sourceOverride
      });
      for (let index = actions.length - 1; index >= 0; index -= 1) {
        const next = actions[index];
        if (next !== undefined) {
          stack.push(next);
        }
      }
      continue;
    }
    if (tagName === "td" || tagName === "th") {
      pushVisits(node.children, preserveWhitespace, sourceOverride);
      continue;
    }
    const childPreserveWhitespace = preserveWhitespace || tagName === "pre" || tagName === "textarea";
    const blockBreakBefore = tagName === "p" || VISIBLE_TEXT_BLOCK_BREAK_TAGS.has(tagName);
    if (blockBreakBefore) {
      pushAppend(
        node,
        tagName === "p" ? "\n\n" : "\n",
        structuralRole,
        false,
        true,
        sourceOverride
      );
    }
    pushVisits(node.children, childPreserveWhitespace, sourceOverride);
    if (blockBreakBefore) {
      pushAppend(node, "\n", structuralRole, false, true, sourceOverride);
    }
  }
}

function* iterateRawExtractionChunks(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  operation: OperationContext
): IterableIterator<ExtractionSourceChunk> {
  const roots = nodeOrTree.kind === "document" || nodeOrTree.kind === "fragment"
    ? nodeOrTree.children
    : [nodeOrTree];
  const stack: HtmlNode[] = [];
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const root = roots[index];
    if (root !== undefined) {
      stack.push(root);
    }
  }
  while (stack.length > 0) {
    operation.checkpoint();
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    if (node.kind === "text") {
      if (node.value.length > 0) {
        yield {
          value: node.value,
          normalizeSegment: false,
          preserveWhitespace: true,
          source: extractionSourceMetaFromNode(node, "text-node")
        };
      }
      continue;
    }
    if (node.kind === "element") {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
}

function resolvedVisibleTextOptions(
  options: VisibleTextExtractionOptions,
  operation: OperationContext
): ResolvedVisibleTextOptions {
  return {
    ...DEFAULT_VISIBLE_TEXT_OPTIONS,
    skipHiddenSubtrees: options.skipHiddenSubtrees ?? DEFAULT_VISIBLE_TEXT_OPTIONS.skipHiddenSubtrees,
    includeControlValues: options.includeControlValues ?? DEFAULT_VISIBLE_TEXT_OPTIONS.includeControlValues,
    includeAccessibleNameFallback:
      options.includeAccessibleNameFallback ?? DEFAULT_VISIBLE_TEXT_OPTIONS.includeAccessibleNameFallback,
    trim: options.trim ?? DEFAULT_VISIBLE_TEXT_OPTIONS.trim,
    maxFallbackInputBytes: options.maxFallbackInputBytes,
    maxFallbackNodes: options.maxFallbackNodes,
    operation
  };
}

function* iterateVisibleTextInternal(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: VisibleTextExtractionOptions,
  operation: OperationContext
): Generator<TextExtractionToken, TextExtractionResult, void> {
  const resolved = resolvedVisibleTextOptions(options, operation);
  const collector = new BoundedTextCollector(options.policy, options.maxOutputBytes, options.maxTokens);
  const normalizer = new StreamingVisibleTextNormalizer(
    resolved.trim,
    options.maxOutputBytes,
    operation,
    {
      emit(value, source): void {
        collector.consumeVisibleScalar(value, source);
      },
      observeOmittedBytes(bytes): void {
        collector.observeOmittedBytes(bytes);
      }
    }
  );
  const roots = nodeOrTree.kind === "document" || nodeOrTree.kind === "fragment"
    ? nodeOrTree.children
    : [nodeOrTree];

  for (const chunk of iterateVisibleExtractionChunks(roots, resolved)) {
    const scalars = chunk.normalizeSegment
      ? iterateNormalizedSegmentScalars(chunk.value, chunk.preserveWhitespace, operation)
      : iterateStringScalars(chunk.value, operation);
    for (const scalar of scalars) {
      normalizer.consume(scalar, chunk.source);
      for (const token of collector.takeReadyTokens()) {
        yield token;
      }
    }
  }
  normalizer.finish();
  for (const token of collector.takeReadyTokens()) {
    yield token;
  }
  const result = collector.finish();
  for (const token of collector.takeReadyTokens()) {
    yield token;
  }
  return result;
}

function* iterateRawTextInternal(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: TextContentExtractionOptions,
  operation: OperationContext
): Generator<TextExtractionToken, TextExtractionResult, void> {
  const collector = new BoundedTextCollector(options.policy, options.maxOutputBytes, options.maxTokens);
  for (const chunk of iterateRawExtractionChunks(nodeOrTree, operation)) {
    for (const scalar of iterateStringScalars(chunk.value, operation)) {
      collector.consumeRawScalar(scalar, chunk.source);
    }
    collector.finishRawChunk();
    for (const token of collector.takeReadyTokens()) {
      yield token;
    }
  }
  const result = collector.finish();
  for (const token of collector.takeReadyTokens()) {
    yield token;
  }
  return result;
}

/** Iterates bounded policy tokens and returns the final result when fully drained. */
export function iterateText(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: TextExtractionOptions
): Generator<TextExtractionToken, TextExtractionResult, void> {
  const startedAt = performance.now();
  const normalizedOptions = normalizeTextExtractionOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  return normalizedOptions.policy === VISIBLE_TEXT_HTML_POLICY
    ? iterateVisibleTextInternal(nodeOrTree, normalizedOptions, operation)
    : iterateRawTextInternal(nodeOrTree, normalizedOptions, operation);
}

/** Extracts bounded text under an explicit, versioned semantic policy. */
export function extractText(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: TextExtractionOptions
): TextExtractionResult {
  const iterator = iterateText(nodeOrTree, options);
  let next = iterator.next();
  while (!next.done) {
    next = iterator.next();
  }
  return next.value;
}

function* iterateNodes(
  nodes: readonly HtmlNode[],
  depth: number,
  operation: OperationContext
): IterableIterator<{ readonly node: HtmlNode; readonly depth: number }> {
  const stack: { readonly node: HtmlNode; readonly depth: number }[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node !== undefined) {
      stack.push({ node, depth });
    }
  }
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) {
      continue;
    }
    operation.checkpoint();
    yield entry;
    if (entry.node.kind === "element") {
      for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
        const child = entry.node.children[index];
        if (child !== undefined) {
          stack.push({ node: child, depth: entry.depth + 1 });
        }
      }
    }
  }
}/**
 * Traverses parsed data deterministically for the `walk` public API.
 */


export function walk(
  tree: DocumentTree | FragmentTree,
  visitor: NodeVisitor,
  options: OperationOptions = {}
): void {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    visitor(entry.node, entry.depth);
    operation.checkpoint();
  }
}/**
 * Traverses parsed data deterministically for the `walkElements` public API.
 */


export function walkElements(
  tree: DocumentTree | FragmentTree,
  visitor: ElementVisitor,
  options: OperationOptions = {}
): void {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (entry.node.kind === "element") {
      visitor(entry.node, entry.depth);
      operation.checkpoint();
    }
  }
}/**
 * Traverses parsed data deterministically for the `findById` public API.
 */


export function findById(
  tree: DocumentTree | FragmentTree,
  id: NodeId,
  options: OperationOptions = {}
): HtmlNode | null {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (entry.node.id === id) {
      return entry.node;
    }
  }

  return null;
}/**
 * Traverses parsed data deterministically for the `findAllByTagName` public API.
 */


function* findAllByTagNameIterator(
  tree: DocumentTree | FragmentTree,
  tagName: string,
  operation: OperationContext
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const normalized = asciiLowercase(tagName);
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (isHtmlElement(entry.node) && asciiLowercase(entry.node.localName) === normalized) {
      yield entry.node;
    }
  }
}

/** Finds every element whose HTML tag name matches, with optional deadline or cancellation controls. */
export function findAllByTagName(
  tree: DocumentTree | FragmentTree,
  tagName: string,
  options: OperationOptions = {}
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  return findAllByTagNameIterator(tree, tagName, operation);
}/**
 * Traverses parsed data deterministically for the `findAllByAttr` public API.
 */

function* findAllByTagNameNSIterator(
  tree: DocumentTree | FragmentTree,
  namespaceUri: string,
  localName: string,
  operation: OperationContext
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (
      entry.node.kind === "element" &&
      entry.node.namespaceUri === namespaceUri &&
      entry.node.localName === localName
    ) {
      yield entry.node;
    }
  }
}

/** Finds elements by exact namespace URI and local name. */
export function findAllByTagNameNS(
  tree: DocumentTree | FragmentTree,
  namespaceUri: string,
  localName: string,
  options: OperationOptions = {}
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const startedAt = performance.now();
  requireString(namespaceUri, "namespaceUri");
  requireString(localName, "localName");
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  return findAllByTagNameNSIterator(tree, namespaceUri, localName, operation);
}


function* findAllByAttrIterator(
  tree: DocumentTree | FragmentTree,
  name: string,
  value: string | undefined,
  operation: OperationContext
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const normalizedName = asciiLowercase(name);
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (!isHtmlElement(entry.node)) {
      continue;
    }

    const matched = entry.node.attributes.some(
      (attribute) =>
        attribute.namespaceUri === null &&
        asciiLowercase(attribute.localName) === normalizedName &&
        (value === undefined || attribute.value === value)
    );
    if (matched) {
      yield entry.node;
    }
  }
}

/** Finds elements carrying an attribute and optional value, with operation controls. */
export function findAllByAttr(
  tree: DocumentTree | FragmentTree,
  name: string,
  value?: string,
  options: OperationOptions = {}
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  return findAllByAttrIterator(tree, name, value, operation);
}

function* findAllByAttrNSIterator(
  tree: DocumentTree | FragmentTree,
  namespaceUri: string | null,
  localName: string,
  value: string | undefined,
  operation: OperationContext
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (entry.node.kind !== "element") {
      continue;
    }
    const matched = entry.node.attributes.some((attribute) =>
      attribute.namespaceUri === namespaceUri &&
      attribute.localName === localName &&
      (value === undefined || attribute.value === value)
    );
    if (matched) {
      yield entry.node;
    }
  }
}

/** Finds elements carrying an attribute with an exact expanded name. */
export function findAllByAttrNS(
  tree: DocumentTree | FragmentTree,
  namespaceUri: string | null,
  localName: string,
  value?: string,
  options: OperationOptions = {}
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const startedAt = performance.now();
  if (namespaceUri !== null) {
    requireString(namespaceUri, "namespaceUri");
  }
  requireString(localName, "localName");
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  return findAllByAttrNSIterator(tree, namespaceUri, localName, value, operation);
}

/**
 * Builds a deterministic structural outline whose entry text is capped at 200
 * canonical UTF-8 bytes without splitting Unicode scalar values.
 */
export function outline(
  tree: DocumentTree | FragmentTree,
  options: OperationOptions = {}
): Outline {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  const entries: OutlineEntry[] = [];
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (!isHtmlElement(entry.node)) {
      continue;
    }
    const normalized = asciiLowercase(entry.node.localName);
    if (/^h[1-6]$/.test(normalized) || normalized === "section" || normalized === "article") {
      const remainingTimeMs = operation.remainingTimeMs();
      const text = extractText(entry.node, {
        policy: TEXT_CONTENT_POLICY,
        maxOutputBytes: 200,
        maxTokens: Number.MAX_SAFE_INTEGER,
        ...(operation.signal === undefined ? {} : { signal: operation.signal }),
        ...(remainingTimeMs === undefined ? {} : { maxTimeMs: Math.floor(remainingTimeMs) })
      }).text;
      entries.push({
        nodeId: entry.node.id,
        depth: entry.depth,
        tagName: entry.node.tagName,
        text
      });
    }
  }

  return { entries };
}

function countNodes(node: HtmlNode, operation: OperationContext): number {
  let count = 0;
  const stack: HtmlNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    operation.checkpoint();
    count += 1;
    if (current.kind === "element") {
      for (let index = current.children.length - 1; index >= 0; index -= 1) {
        const child = current.children[index];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
  return count;
}

interface IndexedNodeSpan {
  readonly span?: Span;
  readonly provenance: SpanProvenance;
}

function indexNodeSpans(nodes: readonly HtmlNode[], into: Map<NodeId, IndexedNodeSpan>): void {
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    into.set(node.id, {
      provenance: node.spanProvenance,
      ...(node.span ? { span: node.span } : {})
    });

    if (node.kind === "element") {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
}

function indexNodes(nodes: readonly HtmlNode[], into: Map<NodeId, HtmlNode>): void {
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    into.set(node.id, node);
    if (node.kind === "element") {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f";
}

function findElementStartTagClose(originalHtml: string, span: Span): number {
  let quote: "\"" | "'" | null = null;

  for (let index = span.start; index < originalHtml.length; index += 1) {
    const current = originalHtml[index];
    if (current === undefined) {
      break;
    }

    if (quote === null && (current === "\"" || current === "'")) {
      quote = current;
      continue;
    }

    if (quote !== null && current === quote) {
      quote = null;
      continue;
    }

    if (quote === null && current === ">") {
      return index;
    }
  }

  return -1;
}

function findAttributeInsertOffset(originalHtml: string, closeIndex: number, tagStart: number): number {
  let cursor = closeIndex - 1;
  while (cursor > tagStart && isWhitespace(originalHtml[cursor] ?? "")) {
    cursor -= 1;
  }

  if (originalHtml[cursor] === "/") {
    return cursor;
  }

  return closeIndex;
}/**
 * Provides deterministic public behavior for `applyPatchPlan`.
 */


function applyPatchSteps(originalHtml: string, plan: PatchPlan): string {
  let cursor = 0;
  let output = "";

  for (const step of plan.steps) {
    if (step.kind === "slice") {
      if (step.start < cursor || step.end < step.start || step.end > originalHtml.length) {
        throw new HtmlPatchPlanningError("INVALID_PLAN_SLICE", {
          detail: "slice bounds must be ordered, non-overlapping, and within the source"
        });
      }

      output += originalHtml.slice(step.start, step.end);
      cursor = step.end;
      continue;
    }

    if (step.at !== cursor || step.at > originalHtml.length) {
      throw new HtmlPatchPlanningError("INVALID_PLAN_INSERTION", {
        detail: "insertion offset must equal the current source cursor"
      });
    }

    output += step.text;
  }

  return output;
}

function requireParsedDocumentSource(document: ParsedDocument): string {
  if (!parsedDocumentSources.has(document)) {
    failPatchPlanning("UNRECOGNIZED_PARSED_DOCUMENT", {
      detail: "document must be the exact object returned by a full-document parse"
    });
  }
  const source = parsedDocumentSources.get(document);
  if (source === null || source === undefined) {
    failPatchPlanning("SOURCE_NOT_RETAINED", {
      detail: 'parse with sourceRetention: "text" before planning or applying patches'
    });
  }
  return source;
}

/** Applies a registered patch plan to the exact parsed document that produced it. */
export function applyPatchPlan(document: ParsedDocument, plan: PatchPlan): string {
  const originalHtml = requireParsedDocumentSource(document);
  if (patchPlanDocuments.get(plan) !== document) {
    failPatchPlanning("PLAN_SOURCE_MISMATCH", {
      detail: "plan must be applied to the exact parsed document used to create it"
    });
  }
  return applyPatchSteps(originalHtml, plan);
}

interface PlannedReplacement {
  readonly sourceIndex: number;
  readonly target: NodeId;
  readonly start: number;
  readonly end: number;
  readonly replacementHtml: string;
}

function failPatchPlanning(
  reason: HtmlPatchPlanningReason,
  options: { readonly target?: NodeId; readonly detail?: string } = {}
): never {
  throw new HtmlPatchPlanningError(reason, options);
}

function requireNode(nodeById: Map<NodeId, HtmlNode>, target: NodeId): HtmlNode {
  const node = nodeById.get(target);
  if (!node) {
    failPatchPlanning("NODE_NOT_FOUND", { target });
  }
  return node;
}

function requireNodeSpan(spanByNode: Map<NodeId, IndexedNodeSpan>, target: NodeId): Span {
  const indexedSpan = spanByNode.get(target);
  if (!indexedSpan) {
    failPatchPlanning("MISSING_NODE_SPAN", { target });
  }
  if (indexedSpan.provenance !== "input") {
    failPatchPlanning("NON_INPUT_SPAN_PROVENANCE", {
      target,
      detail: indexedSpan.provenance
    });
  }
  if (!indexedSpan.span) {
    failPatchPlanning("MISSING_NODE_SPAN", { target });
  }
  return indexedSpan.span;
}

function requireElementNode(nodeById: Map<NodeId, HtmlNode>, target: NodeId): Extract<HtmlNode, { kind: "element" }> {
  const node = requireNode(nodeById, target);
  if (node.kind !== "element") {
    failPatchPlanning("INVALID_EDIT_TARGET", { target, detail: "expected element node target" });
  }
  return node;
}

function buildSetAttrReplacement(
  originalHtml: string,
  nodeById: Map<NodeId, HtmlNode>,
  spanByNode: Map<NodeId, IndexedNodeSpan>,
  edit: Extract<Edit, { readonly kind: "setAttr" }>,
  sourceIndex: number
): PlannedReplacement {
  const element = requireElementNode(nodeById, edit.target);
  const existing = element.attributes.find((entry) => entry.name === edit.name);
  const rendered = `${edit.name}="${escapeAttribute(edit.value)}"`;

  if (existing) {
    if (!existing.span) {
      failPatchPlanning("ATTRIBUTE_SPAN_MISSING", { target: edit.target, detail: edit.name });
    }
    return {
      sourceIndex,
      target: edit.target,
      start: existing.span.start,
      end: existing.span.end,
      replacementHtml: rendered
    };
  }

  const elementSpan = requireNodeSpan(spanByNode, edit.target);
  const closeIndex = findElementStartTagClose(originalHtml, elementSpan);
  if (closeIndex === -1) {
    failPatchPlanning("ELEMENT_START_TAG_NOT_FOUND", { target: edit.target });
  }
  const insertAt = findAttributeInsertOffset(originalHtml, closeIndex, elementSpan.start);
  return {
    sourceIndex,
    target: edit.target,
    start: insertAt,
    end: insertAt,
    replacementHtml: ` ${rendered}`
  };
}

function buildRemoveAttrReplacement(
  originalHtml: string,
  nodeById: Map<NodeId, HtmlNode>,
  spanByNode: Map<NodeId, IndexedNodeSpan>,
  edit: Extract<Edit, { readonly kind: "removeAttr" }>,
  sourceIndex: number
): PlannedReplacement {
  const element = requireElementNode(nodeById, edit.target);
  const existing = element.attributes.find((entry) => entry.name === edit.name);
  if (!existing) {
    failPatchPlanning("ATTRIBUTE_NOT_FOUND", { target: edit.target, detail: edit.name });
  }
  if (!existing.span) {
    failPatchPlanning("ATTRIBUTE_SPAN_MISSING", { target: edit.target, detail: edit.name });
  }

  const elementSpan = requireNodeSpan(spanByNode, edit.target);
  const closeIndex = findElementStartTagClose(originalHtml, elementSpan);
  if (closeIndex === -1) {
    failPatchPlanning("ELEMENT_START_TAG_NOT_FOUND", { target: edit.target });
  }

  let start = existing.span.start;
  let end = existing.span.end;
  while (start > elementSpan.start + 1 && isWhitespace(originalHtml[start - 1] ?? "")) {
    start -= 1;
  }
  if (start === existing.span.start) {
    while (end < closeIndex && isWhitespace(originalHtml[end] ?? "")) {
      end += 1;
    }
  }

  return {
    sourceIndex,
    target: edit.target,
    start,
    end,
    replacementHtml: ""
  };
}

function buildReplacement(
  originalHtml: string,
  nodeById: Map<NodeId, HtmlNode>,
  spanByNode: Map<NodeId, IndexedNodeSpan>,
  edit: Edit,
  sourceIndex: number
): PlannedReplacement {
  if (edit.kind === "removeNode") {
    const span = requireNodeSpan(spanByNode, edit.target);
    return {
      sourceIndex,
      target: edit.target,
      start: span.start,
      end: span.end,
      replacementHtml: ""
    };
  }

  if (edit.kind === "replaceText") {
    const node = requireNode(nodeById, edit.target);
    if (node.kind !== "text") {
      failPatchPlanning("INVALID_EDIT_TARGET", { target: edit.target, detail: "expected text node target" });
    }
    const span = requireNodeSpan(spanByNode, edit.target);
    return {
      sourceIndex,
      target: edit.target,
      start: span.start,
      end: span.end,
      replacementHtml: escapeText(edit.value)
    };
  }

  if (edit.kind === "setAttr") {
    return buildSetAttrReplacement(originalHtml, nodeById, spanByNode, edit, sourceIndex);
  }

  if (edit.kind === "removeAttr") {
    return buildRemoveAttrReplacement(originalHtml, nodeById, spanByNode, edit, sourceIndex);
  }

  if (edit.kind === "insertHtmlBefore") {
    const span = requireNodeSpan(spanByNode, edit.target);
    return {
      sourceIndex,
      target: edit.target,
      start: span.start,
      end: span.start,
      replacementHtml: edit.html
    };
  }

  const span = requireNodeSpan(spanByNode, edit.target);
  return {
    sourceIndex,
    target: edit.target,
    start: span.end,
    end: span.end,
    replacementHtml: edit.html
  };
}/**
 * Computes deterministic public output for `computePatch`.
 */


export function computePatch(document: ParsedDocument, edits: readonly Edit[]): PatchPlan {
  const originalHtml = requireParsedDocumentSource(document);
  if (parsedDocumentSpans.get(document) !== true) {
    failPatchPlanning("SPANS_NOT_CAPTURED", {
      detail: "parse with captureSpans: true before planning patches"
    });
  }

  if (edits.length === 0) {
    const steps: readonly PatchStep[] = Object.freeze([
      Object.freeze({ kind: "slice", start: 0, end: originalHtml.length })
    ]);

    const plan = Object.freeze({
      steps,
      result: originalHtml
    });
    patchPlanDocuments.set(plan, document);
    return plan;
  }

  const spanByNode = new Map<NodeId, IndexedNodeSpan>();
  const nodeById = new Map<NodeId, HtmlNode>();
  indexNodeSpans(document.tree.children, spanByNode);
  indexNodes(document.tree.children, nodeById);

  const replacements = edits.map((edit, sourceIndex) =>
    buildReplacement(originalHtml, nodeById, spanByNode, edit, sourceIndex)
  );

  replacements.sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }

    if (left.end !== right.end) {
      return left.end - right.end;
    }

    return left.sourceIndex - right.sourceIndex;
  });

  let previousEnd = 0;
  for (const replacement of replacements) {
    if (replacement.start < 0 || replacement.end < replacement.start || replacement.end > originalHtml.length) {
      failPatchPlanning("OVERLAPPING_EDITS", {
        target: replacement.target,
        detail: "invalid replacement bounds"
      });
    }
    if (replacement.start < previousEnd) {
      failPatchPlanning("OVERLAPPING_EDITS", { target: replacement.target });
    }
    previousEnd = Math.max(previousEnd, replacement.end);
  }

  const steps: PatchStep[] = [];
  let cursor = 0;
  for (const replacement of replacements) {
    if (cursor < replacement.start) {
      steps.push(
        Object.freeze({
          kind: "slice",
          start: cursor,
          end: replacement.start
        })
      );
    }

    steps.push(
      Object.freeze({
        kind: "insert",
        at: replacement.start,
        text: replacement.replacementHtml
      })
    );
    cursor = replacement.end;
  }

  if (cursor < originalHtml.length) {
    steps.push(
      Object.freeze({
        kind: "slice",
        start: cursor,
        end: originalHtml.length
      })
    );
  }

  const frozenSteps = Object.freeze(steps.map((step) => Object.freeze(step)));
  const result = applyPatchSteps(originalHtml, { steps: frozenSteps, result: "" });

  const plan = Object.freeze({
    steps: frozenSteps,
    result
  });
  patchPlanDocuments.set(plan, document);
  return plan;
}/**
 * Provides deterministic public behavior for `chunk`.
 */


export function chunk(tree: DocumentTree | FragmentTree, options: ChunkOptions = {}): Chunk[] {
  const startedAt = performance.now();
  const normalizedOptions = normalizeChunkOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  const maxChars = normalizedOptions.maxChars ?? 8192;
  const maxNodes = normalizedOptions.maxNodes ?? 256;
  const maxBytes = normalizedOptions.maxBytes ?? Number.POSITIVE_INFINITY;
  const textEncoder = new TextEncoder();
  const chunks: Chunk[] = [];
  let activeContent = "";
  let activeNodes = 0;
  let activeBytes = 0;
  let activeNodeId: NodeId | null = null;
  let index = 0;

  const flush = () => {
    if (activeNodeId === null) {
      return;
    }

    chunks.push({
      index,
      nodeId: activeNodeId,
      content: activeContent,
      nodes: activeNodes
    });

    index += 1;
    activeContent = "";
    activeNodes = 0;
    activeBytes = 0;
    activeNodeId = null;
  };

  for (const node of tree.children) {
    operation.checkpoint();
    const content = serializeNodes([node], operation);
    const nodes = countNodes(node, operation);
    const bytes = textEncoder.encode(content).length;
    const nextChars = activeContent.length + content.length;
    const nextNodes = activeNodes + nodes;
    const nextBytes = activeBytes + bytes;

    if (activeNodeId !== null && (nextChars > maxChars || nextNodes > maxNodes || nextBytes > maxBytes)) {
      flush();
    }

    if (activeNodeId === null) {
      activeNodeId = node.id;
    }

    activeContent += content;
    activeNodes += nodes;
    activeBytes += bytes;
  }

  flush();
  return chunks;
}
