import { decodeHtmlBytes, sniffHtmlEncoding } from "../internal/encoding/mod.js";
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
  validateChunkOptions,
  validateOperationOptions,
  validateParseOptions,
  validateParseStreamOptions,
  validateTokenizeByteStreamEagerOptions,
  validateVisibleTextOptions,
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
  ParseOptions,
  ParseStreamBudgetOptions,
  ParseStreamOptions,
  Span,
  SpanProvenance,
  Token,
  TokenizeByteStreamEagerOptions,
  TraceEvent,
  VisibleTextOptions,
  VisibleTextToken,
  VisibleTextTokenSourceNodeKind,
  VisibleTextTokenSourceRole,
  VisibleTextTokenWithProvenance
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
  ParseOptions,
  ParseStreamBudgetOptions,
  ParseStreamOptions,
  Span,
  SpanProvenance,
  StartTagToken,
  Token,
  TokenAttribute,
  TokenizeByteStreamEagerBudgetOptions,
  TokenizeByteStreamEagerOptions,
  TextNode,
  TraceEvent,
  VisibleTextOptions,
  VisibleTextToken,
  VisibleTextTokenSourceNodeKind,
  VisibleTextTokenSourceRole,
  VisibleTextTokenWithProvenance
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
const DEFAULT_STREAM_ENCODING_PRESCAN_BYTES = 16_384;

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

function normalizeAttributes(attributes: readonly Attribute[]): readonly Attribute[] {
  return [...attributes];
}

function toPublicTagName(internalName: string): string {
  const separator = internalName.indexOf(" ");
  if (separator === -1) {
    return internalName;
  }

  return internalName.slice(separator + 1);
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

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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

function eventSize(event: TraceEvent): number {
  return JSON.stringify(event).length;
}

type TraceEventInput =
  TraceEvent extends infer Event
    ? Event extends { readonly seq: number }
      ? Omit<Event, "seq">
      : never
    : never;

function pushTrace(
  trace: TraceEvent[] | undefined,
  event: TraceEventInput,
  budgets: ParseOptions["budgets"] | undefined,
  operation?: OperationContext
): TraceEvent[] | undefined {
  operation?.checkpoint();
  if (!trace) {
    return undefined;
  }

  const nextEvent = {
    seq: trace.length + 1,
    ...event
  } as TraceEvent;
  const next = [...trace, nextEvent];
  enforceBudget("maxTraceEvents", budgets?.maxTraceEvents, next.length);

  const bytes = next.reduce((total, item) => total + eventSize(item), 0);
  enforceBudget("maxTraceBytes", budgets?.maxTraceBytes, bytes);

  return next;
}

function pushBudgetTrace(
  trace: TraceEvent[] | undefined,
  budget: HtmlBudgetName,
  limit: number | undefined,
  actual: number,
  budgets: ParseOptions["budgets"] | undefined,
  operation?: OperationContext
): TraceEvent[] | undefined {
  return pushTrace(trace, {
    kind: "budget",
    budget,
    limit: limit ?? null,
    actual,
    status: limit === undefined || actual <= limit ? "ok" : "exceeded"
  }, budgets, operation);
}

class PendingTraceBudgetController {
  readonly #enabled: boolean;
  readonly #baseEventCount: number;
  readonly #baseSize: number;
  readonly #budgets: ParseOptions["budgets"] | undefined;
  readonly #operation: OperationContext;
  #pendingEventCount = 0;
  #pendingSize = 0;

  constructor(
    trace: readonly TraceEvent[] | undefined,
    budgets: ParseOptions["budgets"] | undefined,
    operation: OperationContext
  ) {
    this.#enabled = trace !== undefined;
    this.#baseEventCount = trace?.length ?? 0;
    this.#baseSize = trace?.reduce((total, event) => total + eventSize(event), 0) ?? 0;
    this.#budgets = budgets;
    this.#operation = operation;
    if (this.#enabled) {
      // Token, tree-mutation, node-budget, and depth-budget events are always appended.
      enforceBudget("maxTraceEvents", budgets?.maxTraceEvents, this.#baseEventCount + 4);
    }
  }

  retain(value: unknown): void {
    if (!this.#enabled) {
      return;
    }
    this.#operation.checkpoint();
    this.#pendingEventCount += 1;
    enforceBudget(
      "maxTraceEvents",
      this.#budgets?.maxTraceEvents,
      this.#baseEventCount + 4 + this.#pendingEventCount
    );
    this.#pendingSize += JSON.stringify(value).length;
    enforceBudget(
      "maxTraceBytes",
      this.#budgets?.maxTraceBytes,
      this.#baseSize + this.#pendingSize
    );
  }
}

function toPublicSpan(span: TreeSpan | undefined, captureSpans: boolean): Span | undefined {
  if (!captureSpans || !span) {
    return undefined;
  }

  return { start: span.start, end: span.end };
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
  return attributes.map((attribute) => {
    operation.checkpoint();
    const span = toPublicSpan(attribute.span, captureSpans);
    return Object.freeze({
      name: attribute.name,
      value: attribute.value,
      ...(span ? { span } : {})
    });
  });
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
  return errors.map((error) => {
    operation.checkpoint();
    const hasOffsets =
      typeof error.startOffset === "number" &&
      typeof error.endOffset === "number" &&
      error.startOffset >= 0 &&
      error.endOffset >= error.startOffset;
    const parseErrorId = normalizeParseErrorId(error.code);
    return {
      code: "PARSER_ERROR",
      parseErrorId,
      message: error.code,
      ...(hasOffsets
        ? {
            span: {
              start: error.startOffset,
              end: error.endOffset
            }
          }
        : {})
    };
  });
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

function convertTreeNode(
  node: TreeNode,
  assigner: NodeIdAssigner,
  captureSpans: boolean,
  operation: OperationContext
): HtmlNode {
  operation.checkpoint();
  if (node.kind === "text") {
    const span = toPublicSpan(node.span, captureSpans);
    const spanProvenance = toSpanProvenance(node.span, captureSpans);
    return {
      id: assigner.next(),
      kind: "text",
      value: node.value,
      spanProvenance,
      ...(span ? { span } : {})
    };
  }

  if (node.kind === "comment") {
    const span = toPublicSpan(node.span, captureSpans);
    const spanProvenance = toSpanProvenance(node.span, captureSpans);
    return {
      id: assigner.next(),
      kind: "comment",
      value: node.value,
      spanProvenance,
      ...(span ? { span } : {})
    };
  }

  if (node.kind === "doctype") {
    const span = toPublicSpan(node.span, captureSpans);
    const spanProvenance = toSpanProvenance(node.span, captureSpans);
    return {
      id: assigner.next(),
      kind: "doctype",
      name: node.name,
      ...(node.publicId.length > 0 ? { publicId: node.publicId } : {}),
      ...(node.systemId.length > 0 ? { systemId: node.systemId } : {}),
      spanProvenance,
      ...(span ? { span } : {})
    };
  }

  const span = toPublicSpan(node.span, captureSpans);
  const spanProvenance = toSpanProvenance(node.span, captureSpans);
  const children = node.children.map((child) =>
    convertTreeNode(child, assigner, captureSpans, operation)
  );
  const attributes = normalizeAttributes(toAttributes(node.attributes, captureSpans, operation));

  return {
    id: assigner.next(),
    kind: "element",
    tagName: toPublicTagName(node.name),
    attributes,
    children,
    spanProvenance,
    ...(span ? { span } : {})
  };
}

function collectMetricsForNode(node: HtmlNode, depth: number, operation: OperationContext): NodeMetrics {
  operation.checkpoint();
  if (node.kind !== "element") {
    return { nodes: 1, maxDepth: depth };
  }

  let nodes = 1;
  let maxDepth = depth;

  for (const child of node.children) {
    const childMetrics = collectMetricsForNode(child, depth + 1, operation);
    nodes += childMetrics.nodes;
    if (childMetrics.maxDepth > maxDepth) {
      maxDepth = childMetrics.maxDepth;
    }
  }

  return { nodes, maxDepth };
}

function collectMetrics(nodes: readonly HtmlNode[], operation: OperationContext): NodeMetrics {
  let totalNodes = 0;
  let maxDepth = 1;

  for (const node of nodes) {
    const metrics = collectMetricsForNode(node, 2, operation);
    totalNodes += metrics.nodes;
    if (metrics.maxDepth > maxDepth) {
      maxDepth = metrics.maxDepth;
    }
  }

  return { nodes: totalNodes, maxDepth };
}

interface ParseInputContext {
  readonly byteLength: number;
  readonly decodedUtf8ByteLength: number;
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
  const byteLength = utf8ByteLength(html);
  return {
    byteLength,
    decodedUtf8ByteLength: byteLength,
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
  options: ParseOptions | ParseStreamOptions,
  input: ParseInputContext
): DocumentTree {
  const operation = input.operation;
  const budgets = options.budgets;
  const captureSpans = options.captureSpans ?? false;
  const assigner = new NodeIdAssigner();
  const documentId = assigner.next();
  let trace: TraceEvent[] | undefined = options.trace ? [] : undefined;

  operation.checkpoint();
  enforceBudget("maxInputBytes", budgets?.maxInputBytes, input.byteLength);
  enforceBudget(
    "maxDecodedUtf8Bytes",
    budgets?.maxDecodedUtf8Bytes,
    input.decodedUtf8ByteLength
  );
  trace = pushTrace(trace, {
    kind: "decode",
    ...input.decode
  }, budgets, operation);
  if (input.stream !== undefined) {
    trace = pushTrace(trace, {
      kind: "stream",
      bytesRead: input.stream.bytesRead,
      encodingPrescanBytes: input.stream.encodingPrescanBytes,
      encodingPrescanLimitBytes: input.stream.encodingPrescanLimitBytes
    }, budgets, operation);
  }
  trace = pushBudgetTrace(
    trace,
    "maxInputBytes",
    budgets?.maxInputBytes,
    input.byteLength,
    budgets,
    operation
  );
  const pendingTrace = new PendingTraceBudgetController(trace, budgets, operation);

  let tokenCount = 0;
  let previousTokenWasCharacter = false;

  const insertionModeTransitions: {
    readonly fromMode: string;
    readonly toMode: string;
    readonly tokenType: string | null;
    readonly tokenTagName: string | null;
    readonly tokenStartOffset: number | null;
    readonly tokenEndOffset: number | null;
  }[] = [];
  const parseErrorTrace: {
    readonly code: string;
    readonly startOffset?: number;
    readonly endOffset?: number;
  }[] = [];

  const built = buildHtmlTree(html, budgets, {
    captureSpans,
    checkpoint(): void {
      operation.checkpoint();
    },
    ...(trace
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
            pendingTrace.retain(transition);
            insertionModeTransitions.push(transition);
          },
          onParseError(error: {
            readonly code: string;
            readonly startOffset?: number;
            readonly endOffset?: number;
          }): void {
            pendingTrace.retain(error);
            parseErrorTrace.push(error);
          }
        }
      : {})
  });

  trace = pushTrace(trace, {
    kind: "token",
    count: tokenCount
  }, budgets, operation);

  const children = built.document.children.map((node) =>
    convertTreeNode(node, assigner, captureSpans, operation)
  );
  const metrics = collectMetrics(children, operation);
  const totalNodes = metrics.nodes + 1;

  operation.checkpoint();

  trace = pushTrace(trace, {
    kind: "tree-mutation",
    nodeCount: totalNodes,
    errorCount: built.errors.length
  }, budgets, operation);

  for (const transition of insertionModeTransitions) {
    operation.checkpoint();
    trace = pushTrace(trace, {
      kind: "insertionModeTransition",
      fromMode: transition.fromMode,
      toMode: transition.toMode,
      tokenContext: {
        type: transition.tokenType,
        tagName: transition.tokenTagName,
        startOffset: transition.tokenStartOffset,
        endOffset: transition.tokenEndOffset
      }
    }, budgets, operation);
  }

  for (const treeError of parseErrorTrace) {
    operation.checkpoint();
    trace = pushTrace(trace, {
      kind: "parseError",
      parseErrorId: normalizeParseErrorId(treeError.code),
      startOffset: typeof treeError.startOffset === "number" ? treeError.startOffset : null,
      endOffset: typeof treeError.endOffset === "number" ? treeError.endOffset : null
    }, budgets, operation);
  }
  trace = pushBudgetTrace(trace, "maxNodes", budgets?.maxNodes, totalNodes, budgets, operation);
  trace = pushBudgetTrace(trace, "maxDepth", budgets?.maxDepth, metrics.maxDepth, budgets, operation);

  const errors = toParseErrors(built.errors, operation);

  return {
    id: documentId,
    kind: "document",
    children,
    errors,
    ...(trace ? { trace } : {})
  };
}/**
 * Parses input deterministically for the `parse` public API.
 */


export function parse(html: string, options: ParseOptions = {}): DocumentTree {
  const startedAt = performance.now();
  validateParseOptions(options);
  requireString(html, "input");
  const operation = parseOperationContext(options, startedAt);
  operation.checkpoint();
  const input = stringInputContext(html, operation);
  operation.checkpoint();
  return parseDocumentInternal(html, options, input);
}/**
 * Parses input deterministically for the `parseBytes` public API.
 */


export function parseBytes(bytes: Uint8Array, options: ParseOptions = {}): DocumentTree {
  const startedAt = performance.now();
  validateParseOptions(options);
  requireByteArray(bytes, "input");
  const operation = parseOperationContext(options, startedAt);
  operation.checkpoint();
  enforceBudget("maxInputBytes", options.budgets?.maxInputBytes, bytes.byteLength);

  const decodedBudget = new DecodedUtf8BudgetCounter(
    options.budgets?.maxDecodedUtf8Bytes,
    operation
  );

  const decoded = decodeHtmlBytes(
    bytes,
    {
      ...(options.transportEncodingLabel
        ? { transportEncodingLabel: options.transportEncodingLabel }
        : {}),
      onDecodedChunk(chunk): void {
        decodedBudget.append(chunk);
      }
    }
  );
  operation.checkpoint();

  return parseDocumentInternal(decoded.text, options, {
    byteLength: bytes.byteLength,
    decodedUtf8ByteLength: decodedBudget.bytes,
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
  options: ParseOptions = {}
): FragmentTree {
  const startedAt = performance.now();
  validateParseOptions(options);
  requireString(html, "input");
  requireString(contextTagName, "contextTagName");
  const budgets = options.budgets;
  const captureSpans = options.captureSpans ?? false;
  const normalizedContext = contextTagName.trim().toLowerCase();

  if (normalizedContext.length === 0) {
    throw new HtmlConfigurationError(
      "contextTagName",
      "INVALID_VALUE",
      "must be a non-empty tag name"
    );
  }

  const operation = parseOperationContext(options, startedAt);
  operation.checkpoint();

  const inputByteLength = utf8ByteLength(html);
  enforceBudget("maxInputBytes", budgets?.maxInputBytes, inputByteLength);
  enforceBudget("maxDecodedUtf8Bytes", budgets?.maxDecodedUtf8Bytes, inputByteLength);

  const assigner = new NodeIdAssigner();
  const fragmentId = assigner.next();
  let trace: TraceEvent[] | undefined = options.trace ? [] : undefined;

  trace = pushTrace(trace, {
    kind: "decode",
    source: "input",
    encoding: "utf-8",
    sniffSource: "input"
  }, budgets, operation);
  trace = pushBudgetTrace(
    trace,
    "maxInputBytes",
    budgets?.maxInputBytes,
    inputByteLength,
    budgets,
    operation
  );
  const pendingTrace = new PendingTraceBudgetController(trace, budgets, operation);

  let tokenCount = 0;
  let previousTokenWasCharacter = false;

  const insertionModeTransitions: {
    readonly fromMode: string;
    readonly toMode: string;
    readonly tokenType: string | null;
    readonly tokenTagName: string | null;
    readonly tokenStartOffset: number | null;
    readonly tokenEndOffset: number | null;
  }[] = [];
  const parseErrorTrace: {
    readonly code: string;
    readonly startOffset?: number;
    readonly endOffset?: number;
  }[] = [];

  const built = buildHtmlTree(html, budgets, {
    fragmentContextTagName: normalizedContext,
    captureSpans,
    checkpoint(): void {
      operation.checkpoint();
    },
    ...(trace
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
            pendingTrace.retain(transition);
            insertionModeTransitions.push(transition);
          },
          onParseError(error: {
            readonly code: string;
            readonly startOffset?: number;
            readonly endOffset?: number;
          }): void {
            pendingTrace.retain(error);
            parseErrorTrace.push(error);
          }
        }
      : {})
  });

  trace = pushTrace(trace, {
    kind: "token",
    count: tokenCount
  }, budgets, operation);

  const children = built.document.children.map((node) =>
    convertTreeNode(node, assigner, captureSpans, operation)
  );
  const metrics = collectMetrics(children, operation);
  const totalNodes = metrics.nodes + 1;

  operation.checkpoint();

  trace = pushTrace(trace, {
    kind: "tree-mutation",
    nodeCount: totalNodes,
    errorCount: built.errors.length
  }, budgets, operation);

  for (const transition of insertionModeTransitions) {
    operation.checkpoint();
    trace = pushTrace(trace, {
      kind: "insertionModeTransition",
      fromMode: transition.fromMode,
      toMode: transition.toMode,
      tokenContext: {
        type: transition.tokenType,
        tagName: transition.tokenTagName,
        startOffset: transition.tokenStartOffset,
        endOffset: transition.tokenEndOffset
      }
    }, budgets, operation);
  }

  for (const treeError of parseErrorTrace) {
    operation.checkpoint();
    trace = pushTrace(trace, {
      kind: "parseError",
      parseErrorId: normalizeParseErrorId(treeError.code),
      startOffset: typeof treeError.startOffset === "number" ? treeError.startOffset : null,
      endOffset: typeof treeError.endOffset === "number" ? treeError.endOffset : null
    }, budgets, operation);
  }
  trace = pushBudgetTrace(trace, "maxNodes", budgets?.maxNodes, totalNodes, budgets, operation);
  trace = pushBudgetTrace(trace, "maxDepth", budgets?.maxDepth, metrics.maxDepth, budgets, operation);

  const errors = toParseErrors(built.errors, operation);

  return {
    id: fragmentId,
    kind: "fragment",
    contextTagName: normalizedContext,
    children,
    errors,
    ...(trace ? { trace } : {})
  };
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
  validateTokenizeByteStreamEagerOptions(options);
  requireReadableByteStream(stream, "input");
  const operation = createOperationContext(options.budgets?.maxTimeMs, options.signal, startedAt);
  operation.checkpoint();
  return tokenizeDecodedByteStreamEager(stream, options, operation);
}/**
 * Reads and decodes a byte stream through EOF, releases its reader, and then
 * parses the buffered document deterministically.
 */


export async function parseStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseStreamOptions = {}
): Promise<DocumentTree> {
  const startedAt = performance.now();
  validateParseStreamOptions(options);
  requireReadableByteStream(stream, "input");
  const operation = parseOperationContext(options, startedAt);
  operation.checkpoint();
  const decoded = await decodeStreamToText(stream, options, operation);
  return parseDocumentInternal(decoded.text, options, {
    byteLength: decoded.totalBytes,
    decodedUtf8ByteLength: decoded.decodedUtf8Bytes,
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

function serializeNode(node: HtmlNode, operation: OperationContext): string {
  operation.checkpoint();
  if (node.kind === "text") {
    return escapeText(node.value);
  }

  if (node.kind === "comment") {
    return `<!--${node.value}-->`;
  }

  if (node.kind === "doctype") {
    if (node.publicId !== undefined || node.systemId !== undefined) {
      const publicId = node.publicId ?? "";
      const systemId = node.systemId ?? "";
      return `<!DOCTYPE ${node.name} "${publicId}" "${systemId}">`;
    }
    return `<!DOCTYPE ${node.name}>`;
  }

  const attributes = node.attributes.map((entry) => `${entry.name}="${escapeAttribute(entry.value)}"`).join(" ");
  const open = attributes.length > 0 ? `<${node.tagName} ${attributes}>` : `<${node.tagName}>`;

  if (VOID_ELEMENTS.has(node.tagName)) {
    return open;
  }

  const body = node.children.map((child) => serializeNode(child, operation)).join("");
  return `${open}${body}</${node.tagName}>`;
}/**
 * Serializes data deterministically for the `serialize` public API.
 */


export function serialize(
  tree: DocumentTree | FragmentTree | HtmlNode,
  options: OperationOptions = {}
): string {
  const startedAt = performance.now();
  validateOperationOptions(options);
  const operation = createOperationContext(options.maxTimeMs, options.signal, startedAt);
  operation.checkpoint();
  if (tree.kind === "document" || tree.kind === "fragment") {
    return tree.children.map((child) => serializeNode(child, operation)).join("");
  }

  return serializeNode(tree, operation);
}

function textContentFromNode(
  node: DocumentTree | FragmentTree | HtmlNode,
  operation: OperationContext
): string {
  operation.checkpoint();
  if (node.kind === "document" || node.kind === "fragment") {
    return node.children.map((child) => textContentFromNode(child, operation)).join("");
  }

  if (node.kind === "text") {
    return node.value;
  }

  if (node.kind !== "element") {
    return "";
  }

  return node.children.map((child) => textContentFromNode(child, operation)).join("");
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
    VisibleTextOptions,
    "skipHiddenSubtrees" | "includeControlValues" | "includeAccessibleNameFallback" | "trim"
  >
>;

type ResolvedVisibleTextOptions = VisibleTextPolicyOptions & {
  readonly operation: OperationContext;
};

const DEFAULT_VISIBLE_TEXT_OPTIONS: VisibleTextPolicyOptions = Object.freeze({
  skipHiddenSubtrees: true,
  includeControlValues: true,
  includeAccessibleNameFallback: false,
  trim: true
});

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function collapseAsciiWhitespace(value: string): string {
  return value.replace(/[ \t\n\f\r]+/g, " ");
}

function normalizeVisibleTextSegment(value: string, preserveWhitespace: boolean): string {
  const normalized = normalizeNewlines(value);
  if (preserveWhitespace) {
    return normalized;
  }
  return collapseAsciiWhitespace(normalized);
}

function normalizeBooleanAttribute(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "true" || normalized === "1";
}

function attributeValue(node: Extract<HtmlNode, { kind: "element" }>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const attribute of node.attributes) {
    if (attribute.name.toLowerCase() === target) {
      return attribute.value;
    }
  }
  return undefined;
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

function normalizeVisibleTextOutput(value: string, options: ResolvedVisibleTextOptions): string {
  options.operation.checkpoint();
  let output = normalizeNewlines(value);
  output = output.replace(/[ \t\f]+\n/g, "\n");
  output = output.replace(/\n[ \t\f]+/g, "\n");
  output = output.replace(/\n{3,}/g, "\n\n");
  output = output.replace(/[ ]{2,}/g, " ");
  output = output.replace(/\t{2,}/g, "\t");
  if (options.trim) {
    output = output.trim();
  }
  return output;
}

interface VisibleTextSourceMeta {
  readonly sourceNodeId: NodeId | null;
  readonly sourceNodeKind: VisibleTextTokenSourceNodeKind;
  readonly sourceRole: VisibleTextTokenSourceRole;
}

interface VisibleTextSourceChunk extends VisibleTextSourceMeta {
  readonly value: string;
}

interface VisibleTextSourceChar extends VisibleTextSourceMeta {
  readonly char: string;
}

const DEFAULT_VISIBLE_TEXT_SOURCE: VisibleTextSourceMeta = Object.freeze({
  sourceNodeId: null,
  sourceNodeKind: "document",
  sourceRole: "text-node"
});

function sourceMetaFromNode(
  node: HtmlNode | DocumentTree | FragmentTree,
  sourceRole: VisibleTextTokenSourceRole
): VisibleTextSourceMeta {
  if (node.kind === "document" || node.kind === "fragment") {
    return {
      sourceNodeId: node.id,
      sourceNodeKind: node.kind,
      sourceRole
    };
  }
  return {
    sourceNodeId: node.id,
    sourceNodeKind: node.kind,
    sourceRole
  };
}

function appendVisibleText(
  parts: string[],
  value: string,
  sourceChunks?: VisibleTextSourceChunk[],
  sourceMeta: VisibleTextSourceMeta = DEFAULT_VISIBLE_TEXT_SOURCE
): void {
  if (value.length === 0) {
    return;
  }
  parts.push(value);
  if (sourceChunks) {
    sourceChunks.push({
      value,
      sourceNodeId: sourceMeta.sourceNodeId,
      sourceNodeKind: sourceMeta.sourceNodeKind,
      sourceRole: sourceMeta.sourceRole
    });
  }
}

function collectNoscriptRawMarkup(
  node: Extract<HtmlNode, { kind: "element" }>,
  parts: string[],
  options: ResolvedVisibleTextOptions,
  preserveWhitespace: boolean,
  sourceChunks?: VisibleTextSourceChunk[]
): boolean {
  options.operation.checkpoint();
  if (node.tagName.toLowerCase() !== "noscript") {
    return false;
  }

  if (node.children.length !== 1) {
    return false;
  }

  const onlyChild = node.children[0];
  if (!onlyChild || onlyChild.kind !== "text") {
    return false;
  }

  const rawMarkup = onlyChild.value;
  if (!rawMarkup.includes("<") || !rawMarkup.includes(">")) {
    return false;
  }

  const fallbackFragment = parseFragment(rawMarkup, "body");
  options.operation.checkpoint();
  for (const child of fallbackFragment.children) {
    collectVisibleTextFromNode(child, parts, options, preserveWhitespace, sourceChunks, "noscript-fallback");
  }
  return true;
}

function collectVisibleTextFromNode(
  node: HtmlNode,
  parts: string[],
  options: ResolvedVisibleTextOptions,
  preserveWhitespace: boolean,
  sourceChunks?: VisibleTextSourceChunk[],
  sourceRoleOverride: VisibleTextTokenSourceRole | null = null
): void {
  options.operation.checkpoint();
  if (node.kind === "text") {
    appendVisibleText(
      parts,
      normalizeVisibleTextSegment(node.value, preserveWhitespace),
      sourceChunks,
      sourceMetaFromNode(node, sourceRoleOverride ?? "text-node")
    );
    return;
  }

  if (node.kind !== "element") {
    return;
  }

  if (shouldSkipHiddenSubtree(node, options)) {
    return;
  }

  const tagName = node.tagName.toLowerCase();
  const fallbackName = accessibleNameFallback(node, options);
  if (VISIBLE_TEXT_SKIP_TAGS.has(tagName)) {
    return;
  }

  if (collectNoscriptRawMarkup(node, parts, options, preserveWhitespace, sourceChunks)) {
    return;
  }

  if (tagName === "br") {
    appendVisibleText(parts, "\n", sourceChunks, sourceMetaFromNode(node, sourceRoleOverride ?? "structure-break"));
    return;
  }

  if (tagName === "img" && options.includeControlValues) {
    const alt = attributeValue(node, "alt");
    if (alt && alt.length > 0) {
      appendVisibleText(
        parts,
        normalizeVisibleTextSegment(alt, false),
        sourceChunks,
        sourceMetaFromNode(node, sourceRoleOverride ?? "img-alt")
      );
    }
    return;
  }

  if (tagName === "input" && options.includeControlValues) {
    const type = (attributeValue(node, "type") ?? "text").toLowerCase();
    if (type !== "hidden") {
      const value = attributeValue(node, "value");
      if (VISIBLE_TEXT_INPUT_VALUE_TAG_TYPES.has(type) && value && value.length > 0) {
        appendVisibleText(
          parts,
          normalizeVisibleTextSegment(value, false),
          sourceChunks,
          sourceMetaFromNode(node, sourceRoleOverride ?? "input-value")
        );
        return;
      }
      if (fallbackName) {
        appendVisibleText(
          parts,
          normalizeVisibleTextSegment(fallbackName, false),
          sourceChunks,
          sourceMetaFromNode(node, sourceRoleOverride ?? "input-aria-label")
        );
      }
    }
    return;
  }

  if (tagName === "select") {
    return;
  }

  if (tagName === "button" && options.includeControlValues) {
    const value = attributeValue(node, "value");
    if (value && value.length > 0) {
      appendVisibleText(
        parts,
        normalizeVisibleTextSegment(value, false),
        sourceChunks,
        sourceMetaFromNode(node, sourceRoleOverride ?? "button-value")
      );
      return;
    }
  }

  if (tagName === "tr") {
    appendVisibleText(parts, "\n", sourceChunks, sourceMetaFromNode(node, sourceRoleOverride ?? "structure-break"));
    let seenTableCell = false;
    for (const child of node.children) {
      if (child.kind === "element") {
        const childTagName = child.tagName.toLowerCase();
        if (childTagName === "td" || childTagName === "th") {
          if (seenTableCell) {
            appendVisibleText(parts, "\t", sourceChunks, sourceMetaFromNode(node, sourceRoleOverride ?? "structure-break"));
          }
          collectVisibleTextFromNode(child, parts, options, preserveWhitespace, sourceChunks, sourceRoleOverride);
          seenTableCell = true;
          continue;
        }
      }
      collectVisibleTextFromNode(child, parts, options, preserveWhitespace, sourceChunks, sourceRoleOverride);
    }
    appendVisibleText(parts, "\n", sourceChunks, sourceMetaFromNode(node, sourceRoleOverride ?? "structure-break"));
    return;
  }

  if (tagName === "td" || tagName === "th") {
    for (const child of node.children) {
      collectVisibleTextFromNode(child, parts, options, preserveWhitespace, sourceChunks, sourceRoleOverride);
    }
    return;
  }

  const childPreserveWhitespace = preserveWhitespace || tagName === "pre" || tagName === "textarea";
  const blockBreakBefore = tagName === "p" || VISIBLE_TEXT_BLOCK_BREAK_TAGS.has(tagName);
  if (blockBreakBefore) {
    appendVisibleText(parts, "\n", sourceChunks, sourceMetaFromNode(node, sourceRoleOverride ?? "structure-break"));
  }
  for (const child of node.children) {
    collectVisibleTextFromNode(child, parts, options, childPreserveWhitespace, sourceChunks, sourceRoleOverride);
  }
  if (tagName === "p") {
    appendVisibleText(parts, "\n\n", sourceChunks, sourceMetaFromNode(node, sourceRoleOverride ?? "structure-break"));
    return;
  }
  if (blockBreakBefore) {
    appendVisibleText(parts, "\n", sourceChunks, sourceMetaFromNode(node, sourceRoleOverride ?? "structure-break"));
  }
}

function collectVisibleText(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: ResolvedVisibleTextOptions
): string {
  options.operation.checkpoint();
  const parts: string[] = [];
  if (nodeOrTree.kind === "document" || nodeOrTree.kind === "fragment") {
    for (const child of nodeOrTree.children) {
      collectVisibleTextFromNode(child, parts, options, false);
    }
  } else {
    collectVisibleTextFromNode(nodeOrTree, parts, options, false);
  }
  return normalizeVisibleTextOutput(parts.join(""), options);
}

function collectVisibleTextWithSourceChunks(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: ResolvedVisibleTextOptions
): { readonly output: string; readonly sourceChunks: readonly VisibleTextSourceChunk[] } {
  options.operation.checkpoint();
  const parts: string[] = [];
  const sourceChunks: VisibleTextSourceChunk[] = [];
  if (nodeOrTree.kind === "document" || nodeOrTree.kind === "fragment") {
    for (const child of nodeOrTree.children) {
      collectVisibleTextFromNode(child, parts, options, false, sourceChunks);
    }
  } else {
    collectVisibleTextFromNode(nodeOrTree, parts, options, false, sourceChunks);
  }
  return {
    output: normalizeVisibleTextOutput(parts.join(""), options),
    sourceChunks
  };
}

function sourceChunksToChars(
  chunks: readonly VisibleTextSourceChunk[],
  operation: OperationContext
): VisibleTextSourceChar[] {
  const chars: VisibleTextSourceChar[] = [];
  for (const chunk of chunks) {
    for (const char of chunk.value) {
      operation.checkpoint();
      chars.push({
        char,
        sourceNodeId: chunk.sourceNodeId,
        sourceNodeKind: chunk.sourceNodeKind,
        sourceRole: chunk.sourceRole
      });
    }
  }
  return chars;
}

function isSpaceTabFormFeed(char: string): boolean {
  return char === " " || char === "\t" || char === "\f";
}

function collapseSourceChars(
  chars: readonly VisibleTextSourceChar[],
  predicate: (char: string) => boolean,
  limit: number,
  operation: OperationContext
): VisibleTextSourceChar[] {
  const result: VisibleTextSourceChar[] = [];
  let runCount = 0;
  for (const entry of chars) {
    operation.checkpoint();
    if (predicate(entry.char)) {
      runCount += 1;
      if (runCount <= limit) {
        result.push(entry);
      }
      continue;
    }
    runCount = 0;
    result.push(entry);
  }
  return result;
}

function normalizeSourceChars(
  sourceChars: readonly VisibleTextSourceChar[],
  options: ResolvedVisibleTextOptions
): VisibleTextSourceChar[] {
  options.operation.checkpoint();
  const removeSpaceBeforeNewline: VisibleTextSourceChar[] = [];
  for (const entry of sourceChars) {
    options.operation.checkpoint();
    if (entry.char === "\n") {
      while (
        removeSpaceBeforeNewline.length > 0 &&
        isSpaceTabFormFeed(removeSpaceBeforeNewline[removeSpaceBeforeNewline.length - 1]?.char ?? "")
      ) {
        removeSpaceBeforeNewline.pop();
      }
    }
    removeSpaceBeforeNewline.push(entry);
  }

  const removeSpaceAfterNewline: VisibleTextSourceChar[] = [];
  for (const entry of removeSpaceBeforeNewline) {
    options.operation.checkpoint();
    const previous = removeSpaceAfterNewline[removeSpaceAfterNewline.length - 1];
    if (previous?.char === "\n" && isSpaceTabFormFeed(entry.char)) {
      continue;
    }
    removeSpaceAfterNewline.push(entry);
  }

  const collapsedNewlines = collapseSourceChars(
    removeSpaceAfterNewline,
    (char) => char === "\n",
    2,
    options.operation
  );
  const collapsedSpaces = collapseSourceChars(
    collapsedNewlines,
    (char) => char === " ",
    1,
    options.operation
  );
  const collapsedTabs = collapseSourceChars(
    collapsedSpaces,
    (char) => char === "\t",
    1,
    options.operation
  );

  if (!options.trim || collapsedTabs.length === 0) {
    return collapsedTabs;
  }

  let start = 0;
  let end = collapsedTabs.length;
  while (start < end && /\s/.test(collapsedTabs[start]?.char ?? "")) {
    start += 1;
  }
  while (end > start && /\s/.test(collapsedTabs[end - 1]?.char ?? "")) {
    end -= 1;
  }
  return collapsedTabs.slice(start, end);
}

function sameSource(
  left: VisibleTextSourceChar,
  right: VisibleTextSourceChar
): boolean {
  return left.sourceNodeId === right.sourceNodeId
    && left.sourceNodeKind === right.sourceNodeKind
    && left.sourceRole === right.sourceRole;
}

function provenanceToken(
  kind: VisibleTextTokenWithProvenance["kind"],
  value: string,
  source: VisibleTextSourceChar
): VisibleTextTokenWithProvenance {
  return Object.freeze({
    kind,
    value,
    sourceNodeId: source.sourceNodeId,
    sourceNodeKind: source.sourceNodeKind,
    sourceRole: source.sourceRole
  }) as VisibleTextTokenWithProvenance;
}

function tokenizeVisibleTextWithSourceChars(
  chars: readonly VisibleTextSourceChar[],
  operation: OperationContext
): readonly VisibleTextTokenWithProvenance[] {
  const tokens: VisibleTextTokenWithProvenance[] = [];
  let cursor = 0;

  while (cursor < chars.length) {
    operation.checkpoint();
    const current = chars[cursor];
    if (!current) {
      break;
    }

    if (current.char === "\n" && chars[cursor + 1]?.char === "\n") {
      tokens.push(provenanceToken("paragraphBreak", "\n\n", current));
      cursor += 2;
      continue;
    }

    if (current.char === "\n") {
      tokens.push(provenanceToken("lineBreak", "\n", current));
      cursor += 1;
      continue;
    }

    if (current.char === "\t") {
      tokens.push(provenanceToken("tab", "\t", current));
      cursor += 1;
      continue;
    }

    let value = "";
    const source = current;
    while (cursor < chars.length) {
      operation.checkpoint();
      const entry = chars[cursor];
      if (!entry || entry.char === "\n" || entry.char === "\t") {
        break;
      }
      if (!sameSource(source, entry)) {
        break;
      }
      value += entry.char;
      cursor += 1;
    }
    tokens.push(provenanceToken("text", value, source));
  }

  return Object.freeze(tokens);
}

function tokenizeVisibleText(value: string, operation: OperationContext): readonly VisibleTextToken[] {
  const tokens: VisibleTextToken[] = [];
  let cursor = 0;
  let activeText = "";
  const flushText = () => {
    if (activeText.length === 0) {
      return;
    }
    tokens.push(
      Object.freeze({
        kind: "text",
        value: activeText
      })
    );
    activeText = "";
  };

  while (cursor < value.length) {
    operation.checkpoint();
    const char = value[cursor];
    if (char === undefined) {
      break;
    }
    if (char === "\n" && value[cursor + 1] === "\n") {
      flushText();
      tokens.push(Object.freeze({ kind: "paragraphBreak", value: "\n\n" }));
      cursor += 2;
      continue;
    }
    if (char === "\n") {
      flushText();
      tokens.push(Object.freeze({ kind: "lineBreak", value: "\n" }));
      cursor += 1;
      continue;
    }
    if (char === "\t") {
      flushText();
      tokens.push(Object.freeze({ kind: "tab", value: "\t" }));
      cursor += 1;
      continue;
    }
    activeText += char;
    cursor += 1;
  }

  flushText();
  return Object.freeze(tokens);
}/**
 * Provides deterministic public behavior for `visibleText`.
 */


export function visibleText(nodeOrTree: DocumentTree | FragmentTree | HtmlNode, options: VisibleTextOptions = {}): string {
  const startedAt = performance.now();
  validateVisibleTextOptions(options);
  const operation = createOperationContext(options.maxTimeMs, options.signal, startedAt);
  operation.checkpoint();
  const resolvedOptions: ResolvedVisibleTextOptions = {
    ...DEFAULT_VISIBLE_TEXT_OPTIONS,
    skipHiddenSubtrees: options.skipHiddenSubtrees ?? DEFAULT_VISIBLE_TEXT_OPTIONS.skipHiddenSubtrees,
    includeControlValues: options.includeControlValues ?? DEFAULT_VISIBLE_TEXT_OPTIONS.includeControlValues,
    includeAccessibleNameFallback:
      options.includeAccessibleNameFallback ?? DEFAULT_VISIBLE_TEXT_OPTIONS.includeAccessibleNameFallback,
    trim: options.trim ?? DEFAULT_VISIBLE_TEXT_OPTIONS.trim,
    operation
  };
  return collectVisibleText(nodeOrTree, resolvedOptions);
}/**
 * Provides deterministic public behavior for `visibleTextTokens`.
 */


export function visibleTextTokens(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: VisibleTextOptions = {}
): readonly VisibleTextToken[] {
  const startedAt = performance.now();
  validateVisibleTextOptions(options);
  const operation = createOperationContext(options.maxTimeMs, options.signal, startedAt);
  operation.checkpoint();
  const resolvedOptions: ResolvedVisibleTextOptions = {
    ...DEFAULT_VISIBLE_TEXT_OPTIONS,
    skipHiddenSubtrees: options.skipHiddenSubtrees ?? DEFAULT_VISIBLE_TEXT_OPTIONS.skipHiddenSubtrees,
    includeControlValues: options.includeControlValues ?? DEFAULT_VISIBLE_TEXT_OPTIONS.includeControlValues,
    includeAccessibleNameFallback:
      options.includeAccessibleNameFallback ?? DEFAULT_VISIBLE_TEXT_OPTIONS.includeAccessibleNameFallback,
    trim: options.trim ?? DEFAULT_VISIBLE_TEXT_OPTIONS.trim,
    operation
  };
  return tokenizeVisibleText(collectVisibleText(nodeOrTree, resolvedOptions), operation);
}/**
 * Provides deterministic public behavior for `visibleTextTokensWithProvenance`.
 */


export function visibleTextTokensWithProvenance(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: VisibleTextOptions = {}
): readonly VisibleTextTokenWithProvenance[] {
  const startedAt = performance.now();
  validateVisibleTextOptions(options);
  const operation = createOperationContext(options.maxTimeMs, options.signal, startedAt);
  operation.checkpoint();
  const resolvedOptions: ResolvedVisibleTextOptions = {
    ...DEFAULT_VISIBLE_TEXT_OPTIONS,
    skipHiddenSubtrees: options.skipHiddenSubtrees ?? DEFAULT_VISIBLE_TEXT_OPTIONS.skipHiddenSubtrees,
    includeControlValues: options.includeControlValues ?? DEFAULT_VISIBLE_TEXT_OPTIONS.includeControlValues,
    includeAccessibleNameFallback:
      options.includeAccessibleNameFallback ?? DEFAULT_VISIBLE_TEXT_OPTIONS.includeAccessibleNameFallback,
    trim: options.trim ?? DEFAULT_VISIBLE_TEXT_OPTIONS.trim,
    operation
  };
  const { output, sourceChunks } = collectVisibleTextWithSourceChunks(nodeOrTree, resolvedOptions);
  const normalizedSourceChars = normalizeSourceChars(
    sourceChunksToChars(sourceChunks, operation),
    resolvedOptions
  );
  const normalizedOutput = normalizedSourceChars.map((entry) => entry.char).join("");

  if (normalizedOutput !== output) {
    const fallbackSource: VisibleTextSourceChar = {
      char: "",
      sourceNodeId: null,
      sourceNodeKind: "document",
      sourceRole: "text-node"
    };
    return Object.freeze(
      tokenizeVisibleText(output, operation).map((token) => provenanceToken(
        token.kind,
        token.value,
        token.kind === "text" ? fallbackSource : { ...fallbackSource, sourceRole: "structure-break" }
      ))
    );
  }

  return tokenizeVisibleTextWithSourceChars(normalizedSourceChars, operation);
}

function* iterateNodes(
  nodes: readonly HtmlNode[],
  depth: number,
  operation: OperationContext
): IterableIterator<{ readonly node: HtmlNode; readonly depth: number }> {
  for (const node of nodes) {
    operation.checkpoint();
    yield { node, depth };
    if (node.kind === "element") {
      yield* iterateNodes(node.children, depth + 1, operation);
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
  validateOperationOptions(options);
  const operation = createOperationContext(options.maxTimeMs, options.signal, startedAt);
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
  validateOperationOptions(options);
  const operation = createOperationContext(options.maxTimeMs, options.signal, startedAt);
  operation.checkpoint();
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (entry.node.kind === "element") {
      visitor(entry.node, entry.depth);
      operation.checkpoint();
    }
  }
}/**
 * Provides deterministic public behavior for `textContent`.
 */


export function textContent(
  node: DocumentTree | FragmentTree | HtmlNode,
  options: OperationOptions = {}
): string {
  const startedAt = performance.now();
  validateOperationOptions(options);
  const operation = createOperationContext(options.maxTimeMs, options.signal, startedAt);
  operation.checkpoint();
  return textContentFromNode(node, operation);
}/**
 * Traverses parsed data deterministically for the `findById` public API.
 */


export function findById(
  tree: DocumentTree | FragmentTree,
  id: NodeId,
  options: OperationOptions = {}
): HtmlNode | null {
  const startedAt = performance.now();
  validateOperationOptions(options);
  const operation = createOperationContext(options.maxTimeMs, options.signal, startedAt);
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
  const normalized = tagName.toLowerCase();
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (entry.node.kind === "element" && entry.node.tagName.toLowerCase() === normalized) {
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
  validateOperationOptions(options);
  const operation = createOperationContext(options.maxTimeMs, options.signal, startedAt);
  operation.checkpoint();
  return findAllByTagNameIterator(tree, tagName, operation);
}/**
 * Traverses parsed data deterministically for the `findAllByAttr` public API.
 */


function* findAllByAttrIterator(
  tree: DocumentTree | FragmentTree,
  name: string,
  value: string | undefined,
  operation: OperationContext
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (entry.node.kind !== "element") {
      continue;
    }

    const matched = entry.node.attributes.some(
      (attribute) => attribute.name === name && (value === undefined || attribute.value === value)
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
  validateOperationOptions(options);
  const operation = createOperationContext(options.maxTimeMs, options.signal, startedAt);
  operation.checkpoint();
  return findAllByAttrIterator(tree, name, value, operation);
}

function collectOutlineNodes(
  node: HtmlNode,
  depth: number,
  entries: OutlineEntry[],
  operation: OperationContext
): void {
  operation.checkpoint();
  if (node.kind !== "element") {
    return;
  }

  const normalized = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(normalized) || normalized === "section" || normalized === "article") {
    entries.push({
      nodeId: node.id,
      depth,
      tagName: node.tagName,
      text: textContentFromNode(node, operation).slice(0, 200)
    });
  }

  for (const child of node.children) {
    collectOutlineNodes(child, depth + 1, entries, operation);
  }
}/**
 * Provides deterministic public behavior for `outline`.
 */


export function outline(
  tree: DocumentTree | FragmentTree,
  options: OperationOptions = {}
): Outline {
  const startedAt = performance.now();
  validateOperationOptions(options);
  const operation = createOperationContext(options.maxTimeMs, options.signal, startedAt);
  operation.checkpoint();
  const entries: OutlineEntry[] = [];
  for (const child of tree.children) {
    collectOutlineNodes(child, 0, entries, operation);
  }

  return { entries };
}

function countNodes(node: HtmlNode, operation: OperationContext): number {
  operation.checkpoint();
  if (node.kind !== "element") {
    return 1;
  }

  return 1 + node.children.reduce((total, child) => total + countNodes(child, operation), 0);
}

interface IndexedNodeSpan {
  readonly span?: Span;
  readonly provenance: SpanProvenance;
}

function indexNodeSpans(nodes: readonly HtmlNode[], into: Map<NodeId, IndexedNodeSpan>): void {
  for (const node of nodes) {
    into.set(node.id, {
      provenance: node.spanProvenance,
      ...(node.span ? { span: node.span } : {})
    });

    if (node.kind === "element") {
      indexNodeSpans(node.children, into);
    }
  }
}

function indexNodes(nodes: readonly HtmlNode[], into: Map<NodeId, HtmlNode>): void {
  for (const node of nodes) {
    into.set(node.id, node);
    if (node.kind === "element") {
      indexNodes(node.children, into);
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


export function applyPatchPlan(originalHtml: string, plan: PatchPlan): string {
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


export function computePatch(originalHtml: string, edits: readonly Edit[]): PatchPlan {
  if (edits.length === 0) {
    const steps: readonly PatchStep[] = Object.freeze([
      Object.freeze({ kind: "slice", start: 0, end: originalHtml.length })
    ]);

    return Object.freeze({
      steps,
      result: originalHtml
    });
  }

  const parsed = parse(originalHtml, { captureSpans: true });
  const spanByNode = new Map<NodeId, IndexedNodeSpan>();
  const nodeById = new Map<NodeId, HtmlNode>();
  indexNodeSpans(parsed.children, spanByNode);
  indexNodes(parsed.children, nodeById);

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
  const result = applyPatchPlan(originalHtml, { steps: frozenSteps, result: "" });

  return Object.freeze({
    steps: frozenSteps,
    result
  });
}/**
 * Provides deterministic public behavior for `chunk`.
 */


export function chunk(tree: DocumentTree | FragmentTree, options: ChunkOptions = {}): Chunk[] {
  const startedAt = performance.now();
  validateChunkOptions(options);
  const operation = createOperationContext(options.maxTimeMs, options.signal, startedAt);
  operation.checkpoint();
  const maxChars = options.maxChars ?? 8192;
  const maxNodes = options.maxNodes ?? 256;
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
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
    const content = serializeNode(node, operation);
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
