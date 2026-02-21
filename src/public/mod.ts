import { decodeHtmlBytes, sniffHtmlEncoding } from "../internal/encoding/mod.js";
import { tokenize, type HtmlToken, type TokenizerBudgets } from "../internal/tokenizer/mod.js";
import {
  buildTreeFromHtml,
  type TreeAttribute,
  type TreeBudgets,
  type TreeNode,
  type TreeSpan
} from "../internal/tree/mod.js";

import type {
  Attribute,
  BudgetExceededPayload,
  Chunk,
  ChunkOptions,
  DocumentTree,
  Edit,
  ElementVisitor,
  FragmentTree,
  HtmlNode,
  NodeId,
  NodeVisitor,
  Outline,
  OutlineEntry,
  PatchPlanningErrorPayload,
  PatchPlan,
  PatchStep,
  ParseError,
  ParseOptions,
  Span,
  SpanProvenance,
  Token,
  TokenizeStreamOptions,
  TraceEvent,
  VisibleTextOptions,
  VisibleTextToken,
  VisibleTextTokenSourceNodeKind,
  VisibleTextTokenSourceRole,
  VisibleTextTokenWithProvenance
} from "./types.js";

export type {
  Attribute,
  BudgetOptions,
  BudgetExceededPayload,
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
  HtmlNode,
  NodeId,
  NodeKind,
  NodeVisitor,
  Outline,
  OutlineEntry,
  PatchPlanningErrorPayload,
  PatchInsertStep,
  PatchPlan,
  PatchSliceStep,
  PatchStep,
  ParseError,
  ParseOptions,
  Span,
  SpanProvenance,
  StartTagToken,
  Token,
  TokenAttribute,
  TokenizeStreamOptions,
  TextNode,
  TraceEvent,
  VisibleTextOptions,
  VisibleTextToken,
  VisibleTextTokenSourceNodeKind,
  VisibleTextTokenSourceRole,
  VisibleTextTokenWithProvenance
} from "./types.js";

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
const STREAM_ENCODING_PRESCAN_BYTES = 16_384;

export class BudgetExceededError extends Error {
  readonly payload: BudgetExceededPayload;

  constructor(payload: BudgetExceededPayload) {
    super(
      `Budget exceeded: ${payload.budget} limit=${String(payload.limit)} actual=${String(payload.actual)}`
    );
    this.name = "BudgetExceededError";
    this.payload = payload;
  }
}

export class PatchPlanningError extends Error {
  readonly payload: PatchPlanningErrorPayload;

  constructor(payload: PatchPlanningErrorPayload) {
    super(
      `Patch planning failed: ${payload.code}${
        payload.target === undefined ? "" : ` target=${String(payload.target)}`
      }`
    );
    this.name = "PatchPlanningError";
    this.payload = payload;
  }
}

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
  budget: BudgetExceededPayload["budget"],
  limit: number | undefined,
  actual: number
): void {
  if (limit === undefined || actual <= limit) {
    return;
  }

  throw new BudgetExceededError({
    code: "BUDGET_EXCEEDED",
    budget,
    limit,
    actual
  });
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
  budgets: ParseOptions["budgets"] | undefined
): TraceEvent[] | undefined {
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
  budget: BudgetExceededPayload["budget"],
  limit: number | undefined,
  actual: number,
  budgets: ParseOptions["budgets"] | undefined
): TraceEvent[] | undefined {
  return pushTrace(trace, {
    kind: "budget",
    budget,
    limit: limit ?? null,
    actual,
    status: limit === undefined || actual <= limit ? "ok" : "exceeded"
  }, budgets);
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

function toAttributes(attributes: readonly TreeAttribute[], captureSpans: boolean): readonly Attribute[] {
  return attributes.map((attribute) => {
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
}

export function getParseErrorSpecRef(parseErrorId: string): string {
  void parseErrorId;
  return WHATWG_PARSE_ERRORS_SECTION_URL;
}

function toParseErrors(
  errors: readonly {
    readonly code: string;
    readonly startOffset?: number;
    readonly endOffset?: number;
  }[]
): readonly ParseError[] {
  return errors.map((error) => {
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

function tokenizerBudgetsFromParseOptions(
  budgets: ParseOptions["budgets"] | undefined
): TokenizerBudgets | undefined {
  if (!budgets) {
    return undefined;
  }

  const next: TokenizerBudgets = {
    ...(budgets.maxInputBytes !== undefined ? { maxTextBytes: budgets.maxInputBytes } : {}),
    ...(budgets.maxTimeMs !== undefined ? { maxTimeMs: budgets.maxTimeMs } : {})
  };

  return Object.keys(next).length > 0 ? next : undefined;
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
    ...(budgets.maxDepth !== undefined ? { maxDepth: budgets.maxDepth } : {})
  };

  return Object.keys(next).length > 0 ? next : undefined;
}

function convertTreeNode(node: TreeNode, assigner: NodeIdAssigner, captureSpans: boolean): HtmlNode {
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
  const children = node.children.map((child) => convertTreeNode(child, assigner, captureSpans));
  const attributes = normalizeAttributes(toAttributes(node.attributes, captureSpans));

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

function collectMetricsForNode(node: HtmlNode, depth: number): NodeMetrics {
  if (node.kind !== "element") {
    return { nodes: 1, maxDepth: depth };
  }

  let nodes = 1;
  let maxDepth = depth;

  for (const child of node.children) {
    const childMetrics = collectMetricsForNode(child, depth + 1);
    nodes += childMetrics.nodes;
    if (childMetrics.maxDepth > maxDepth) {
      maxDepth = childMetrics.maxDepth;
    }
  }

  return { nodes, maxDepth };
}

function collectMetrics(nodes: readonly HtmlNode[]): NodeMetrics {
  let totalNodes = 0;
  let maxDepth = 1;

  for (const node of nodes) {
    const metrics = collectMetricsForNode(node, 2);
    totalNodes += metrics.nodes;
    if (metrics.maxDepth > maxDepth) {
      maxDepth = metrics.maxDepth;
    }
  }

  return { nodes: totalNodes, maxDepth };
}

function parseDocumentInternal(html: string, options: ParseOptions = {}): DocumentTree {
  const startedAt = Date.now();
  const budgets = options.budgets;
  const captureSpans = options.captureSpans ?? options.includeSpans ?? false;
  const assigner = new NodeIdAssigner();
  const documentId = assigner.next();
  let trace: TraceEvent[] | undefined = options.trace ? [] : undefined;

  enforceBudget("maxInputBytes", budgets?.maxInputBytes, html.length);
  trace = pushTrace(trace, {
    kind: "decode",
    source: "input",
    encoding: "utf-8",
    sniffSource: "input"
  }, budgets);
  trace = pushBudgetTrace(trace, "maxInputBytes", budgets?.maxInputBytes, html.length, budgets);

  const tokenizerBudgets = tokenizerBudgetsFromParseOptions(budgets);
  const tokenized = tokenizerBudgets ? tokenize(html, { budgets: tokenizerBudgets }) : tokenize(html);

  trace = pushTrace(trace, {
    kind: "token",
    count: tokenized.tokens.length
  }, budgets);

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

  const built = buildTreeFromHtml(html, treeBudgetsFromParseOptions(budgets), {
    captureSpans,
    ...(trace
      ? {
          onInsertionModeTransition(transition: {
            readonly fromMode: string;
            readonly toMode: string;
            readonly tokenType: string | null;
            readonly tokenTagName: string | null;
            readonly tokenStartOffset: number | null;
            readonly tokenEndOffset: number | null;
          }): void {
            insertionModeTransitions.push(transition);
          },
          onParseError(error: {
            readonly code: string;
            readonly startOffset?: number;
            readonly endOffset?: number;
          }): void {
            parseErrorTrace.push(error);
          }
        }
      : {})
  });

  const children = built.document.children.map((node) => convertTreeNode(node, assigner, captureSpans));
  const metrics = collectMetrics(children);
  const totalNodes = metrics.nodes + 1;

  enforceBudget("maxNodes", budgets?.maxNodes, totalNodes);
  enforceBudget("maxDepth", budgets?.maxDepth, metrics.maxDepth);
  const elapsedMs = Date.now() - startedAt;
  enforceBudget("maxTimeMs", budgets?.maxTimeMs, elapsedMs);

  trace = pushTrace(trace, {
    kind: "tree-mutation",
    nodeCount: totalNodes,
    errorCount: built.errors.length
  }, budgets);

  for (const transition of insertionModeTransitions) {
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
    }, budgets);
  }

  for (const treeError of parseErrorTrace) {
    trace = pushTrace(trace, {
      kind: "parseError",
      parseErrorId: normalizeParseErrorId(treeError.code),
      startOffset: typeof treeError.startOffset === "number" ? treeError.startOffset : null,
      endOffset: typeof treeError.endOffset === "number" ? treeError.endOffset : null
    }, budgets);
  }
  trace = pushBudgetTrace(trace, "maxNodes", budgets?.maxNodes, totalNodes, budgets);
  trace = pushBudgetTrace(trace, "maxDepth", budgets?.maxDepth, metrics.maxDepth, budgets);

  const errors = toParseErrors(built.errors);

  return {
    id: documentId,
    kind: "document",
    children,
    errors,
    ...(trace ? { trace } : {})
  };
}

export function parse(html: string, options: ParseOptions = {}): DocumentTree {
  return parseDocumentInternal(html, options);
}

export function parseBytes(bytes: Uint8Array, options: ParseOptions = {}): DocumentTree {
  enforceBudget("maxInputBytes", options.budgets?.maxInputBytes, bytes.byteLength);

  const decoded = decodeHtmlBytes(
    bytes,
    options.transportEncodingLabel
      ? { transportEncodingLabel: options.transportEncodingLabel }
      : {}
  );

  const parsed = parse(decoded.text, options);
  if (!parsed.trace) {
    return parsed;
  }

  const withDecodeTrace = pushTrace(
    [...parsed.trace],
    {
      kind: "decode",
      source: "sniff",
      encoding: decoded.sniff.encoding,
      sniffSource: decoded.sniff.source
    },
    options.budgets
  );

  if (!withDecodeTrace) {
    return parsed;
  }

  return {
    ...parsed,
    trace: withDecodeTrace
  };
}

export function parseFragment(
  html: string,
  contextTagName: string,
  options: ParseOptions = {}
): FragmentTree {
  const startedAt = Date.now();
  const budgets = options.budgets;
  const captureSpans = options.captureSpans ?? options.includeSpans ?? false;
  const normalizedContext = contextTagName.trim().toLowerCase();

  if (normalizedContext.length === 0) {
    throw new Error("contextTagName must be a non-empty tag name");
  }

  enforceBudget("maxInputBytes", budgets?.maxInputBytes, html.length);

  const assigner = new NodeIdAssigner();
  const fragmentId = assigner.next();
  let trace: TraceEvent[] | undefined = options.trace ? [] : undefined;

  trace = pushTrace(trace, {
    kind: "decode",
    source: "input",
    encoding: "utf-8",
    sniffSource: "input"
  }, budgets);
  trace = pushBudgetTrace(trace, "maxInputBytes", budgets?.maxInputBytes, html.length, budgets);

  const tokenizerBudgets = tokenizerBudgetsFromParseOptions(budgets);
  const tokenized = tokenizerBudgets ? tokenize(html, { budgets: tokenizerBudgets }) : tokenize(html);

  trace = pushTrace(trace, {
    kind: "token",
    count: tokenized.tokens.length
  }, budgets);

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

  const built = buildTreeFromHtml(html, treeBudgetsFromParseOptions(budgets), {
    fragmentContextTagName: normalizedContext,
    captureSpans,
    ...(trace
      ? {
          onInsertionModeTransition(transition: {
            readonly fromMode: string;
            readonly toMode: string;
            readonly tokenType: string | null;
            readonly tokenTagName: string | null;
            readonly tokenStartOffset: number | null;
            readonly tokenEndOffset: number | null;
          }): void {
            insertionModeTransitions.push(transition);
          },
          onParseError(error: {
            readonly code: string;
            readonly startOffset?: number;
            readonly endOffset?: number;
          }): void {
            parseErrorTrace.push(error);
          }
        }
      : {})
  });

  const children = built.document.children.map((node) => convertTreeNode(node, assigner, captureSpans));
  const metrics = collectMetrics(children);
  const totalNodes = metrics.nodes + 1;

  enforceBudget("maxNodes", budgets?.maxNodes, totalNodes);
  enforceBudget("maxDepth", budgets?.maxDepth, metrics.maxDepth);
  const elapsedMs = Date.now() - startedAt;
  enforceBudget("maxTimeMs", budgets?.maxTimeMs, elapsedMs);

  trace = pushTrace(trace, {
    kind: "tree-mutation",
    nodeCount: totalNodes,
    errorCount: built.errors.length
  }, budgets);

  for (const transition of insertionModeTransitions) {
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
    }, budgets);
  }

  for (const treeError of parseErrorTrace) {
    trace = pushTrace(trace, {
      kind: "parseError",
      parseErrorId: normalizeParseErrorId(treeError.code),
      startOffset: typeof treeError.startOffset === "number" ? treeError.startOffset : null,
      endOffset: typeof treeError.endOffset === "number" ? treeError.endOffset : null
    }, budgets);
  }
  trace = pushBudgetTrace(trace, "maxNodes", budgets?.maxNodes, totalNodes, budgets);
  trace = pushBudgetTrace(trace, "maxDepth", budgets?.maxDepth, metrics.maxDepth, budgets);

  const errors = toParseErrors(built.errors);

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
  readonly sniff: { encoding: string; source: "bom" | "transport" | "meta" | "default" };
  readonly totalBytes: number;
  readonly maxBufferedObserved: number;
}

async function decodeStreamToText(
  stream: ReadableStream<Uint8Array>,
  options: { readonly transportEncodingLabel?: string; readonly budgets?: ParseOptions["budgets"] }
): Promise<StreamDecodeResult> {
  const startedAt = Date.now();
  const budgets = options.budgets;
  const reader = stream.getReader();
  let total = 0;
  const pendingChunks: Uint8Array[] = [];
  let pendingBytes = 0;
  let maxBufferedObserved = 0;
  let sniff: { encoding: string; source: "bom" | "transport" | "meta" | "default" } | null = null;
  let decoder: TextDecoder | undefined;
  const decodedParts: string[] = [];
  const sniffOptions =
    options.transportEncodingLabel === undefined
      ? { maxPrescanBytes: STREAM_ENCODING_PRESCAN_BYTES }
      : {
          transportEncodingLabel: options.transportEncodingLabel,
          maxPrescanBytes: STREAM_ENCODING_PRESCAN_BYTES
        };

  const readPendingBytes = (): Uint8Array => {
    if (pendingBytes === 0) {
      return new Uint8Array(0);
    }

    const combined = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const chunk of pendingChunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined;
  };

  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }

    const chunkValue = next.value;
    total += chunkValue.byteLength;

    enforceBudget("maxInputBytes", budgets?.maxInputBytes, total);
    enforceBudget("maxTimeMs", budgets?.maxTimeMs, Date.now() - startedAt);

    if (!sniff) {
      pendingChunks.push(chunkValue);
      pendingBytes += chunkValue.byteLength;
      maxBufferedObserved = Math.max(maxBufferedObserved, pendingBytes);
      enforceBudget("maxBufferedBytes", budgets?.maxBufferedBytes, pendingBytes);

      if (pendingBytes < STREAM_ENCODING_PRESCAN_BYTES) {
        continue;
      }

      const bufferedBytes = readPendingBytes();
      sniff = sniffHtmlEncoding(bufferedBytes, sniffOptions);
      decoder = new TextDecoder(sniff.encoding);
      const decoded = decoder.decode(bufferedBytes, { stream: true });
      if (decoded.length > 0) {
        decodedParts.push(decoded);
      }
      pendingChunks.length = 0;
      pendingBytes = 0;
      continue;
    }

    maxBufferedObserved = Math.max(maxBufferedObserved, chunkValue.byteLength);
    enforceBudget("maxBufferedBytes", budgets?.maxBufferedBytes, chunkValue.byteLength);
    if (!decoder) {
      throw new Error("stream decoder unavailable");
    }

    const decoded = decoder.decode(chunkValue, { stream: true });
    if (decoded.length > 0) {
      decodedParts.push(decoded);
    }
  }

  if (!sniff) {
    const bufferedBytes = readPendingBytes();
    sniff = sniffHtmlEncoding(bufferedBytes, sniffOptions);
    decoder = new TextDecoder(sniff.encoding);
    const decoded = decoder.decode(bufferedBytes, { stream: true });
    if (decoded.length > 0) {
      decodedParts.push(decoded);
    }
  }

  if (!decoder) {
    throw new Error("stream decoder initialization failed");
  }

  const decodedTail = decoder.decode();
  if (decodedTail.length > 0) {
    decodedParts.push(decodedTail);
  }

  return {
    text: decodedParts.join(""),
    sniff,
    totalBytes: total,
    maxBufferedObserved
  };
}

export async function* tokenizeStream(
  stream: ReadableStream<Uint8Array>,
  options: TokenizeStreamOptions = {}
): AsyncIterable<Token> {
  const decoded = await decodeStreamToText(stream, options);
  const tokenizerBudgets = tokenizerBudgetsFromParseOptions(options.budgets);
  const tokenized = tokenizerBudgets ? tokenize(decoded.text, { budgets: tokenizerBudgets }) : tokenize(decoded.text);

  for (const token of tokenized.tokens) {
    yield toToken(token);
  }
}

export async function parseStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseOptions = {}
): Promise<DocumentTree> {
  const budgets = options.budgets;
  const decoded = await decodeStreamToText(stream, options);
  const parsed = parse(decoded.text, options);
  if (!parsed.trace) {
    return parsed;
  }

  let trace = [...parsed.trace];
  trace = pushTrace(trace, {
    kind: "decode",
    source: "sniff",
    encoding: decoded.sniff.encoding,
    sniffSource: decoded.sniff.source
  }, budgets) ?? trace;
  trace = pushTrace(trace, {
    kind: "stream",
    bytesRead: decoded.totalBytes
  }, budgets) ?? trace;
  trace = pushBudgetTrace(
    trace,
    "maxBufferedBytes",
    budgets?.maxBufferedBytes,
    decoded.maxBufferedObserved,
    budgets
  ) ?? trace;

  return {
    ...parsed,
    trace
  };
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function serializeNode(node: HtmlNode): string {
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

  const body = node.children.map((child) => serializeNode(child)).join("");
  return `${open}${body}</${node.tagName}>`;
}

export function serialize(tree: DocumentTree | FragmentTree | HtmlNode): string {
  if (tree.kind === "document" || tree.kind === "fragment") {
    return tree.children.map((child) => serializeNode(child)).join("");
  }

  return serializeNode(tree);
}

function textContentFromNode(node: DocumentTree | FragmentTree | HtmlNode): string {
  if (node.kind === "document" || node.kind === "fragment") {
    return node.children.map((child) => textContentFromNode(child)).join("");
  }

  if (node.kind === "text") {
    return node.value;
  }

  if (node.kind !== "element") {
    return "";
  }

  return node.children.map((child) => textContentFromNode(child)).join("");
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

const DEFAULT_VISIBLE_TEXT_OPTIONS: Required<VisibleTextOptions> = Object.freeze({
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
  options: Required<VisibleTextOptions>
): boolean {
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
  options: Required<VisibleTextOptions>
): string | undefined {
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

function normalizeVisibleTextOutput(value: string, options: Required<VisibleTextOptions>): string {
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
  options: Required<VisibleTextOptions>,
  preserveWhitespace: boolean,
  sourceChunks?: VisibleTextSourceChunk[]
): boolean {
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
  for (const child of fallbackFragment.children) {
    collectVisibleTextFromNode(child, parts, options, preserveWhitespace, sourceChunks, "noscript-fallback");
  }
  return true;
}

function collectVisibleTextFromNode(
  node: HtmlNode,
  parts: string[],
  options: Required<VisibleTextOptions>,
  preserveWhitespace: boolean,
  sourceChunks?: VisibleTextSourceChunk[],
  sourceRoleOverride: VisibleTextTokenSourceRole | null = null
): void {
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
  options: Required<VisibleTextOptions>
): string {
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
  options: Required<VisibleTextOptions>
): { readonly output: string; readonly sourceChunks: readonly VisibleTextSourceChunk[] } {
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

function sourceChunksToChars(chunks: readonly VisibleTextSourceChunk[]): VisibleTextSourceChar[] {
  const chars: VisibleTextSourceChar[] = [];
  for (const chunk of chunks) {
    for (const char of chunk.value) {
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
  limit: number
): VisibleTextSourceChar[] {
  const result: VisibleTextSourceChar[] = [];
  let runCount = 0;
  for (const entry of chars) {
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
  options: Required<VisibleTextOptions>
): VisibleTextSourceChar[] {
  const removeSpaceBeforeNewline: VisibleTextSourceChar[] = [];
  for (const entry of sourceChars) {
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
    const previous = removeSpaceAfterNewline[removeSpaceAfterNewline.length - 1];
    if (previous?.char === "\n" && isSpaceTabFormFeed(entry.char)) {
      continue;
    }
    removeSpaceAfterNewline.push(entry);
  }

  const collapsedNewlines = collapseSourceChars(removeSpaceAfterNewline, (char) => char === "\n", 2);
  const collapsedSpaces = collapseSourceChars(collapsedNewlines, (char) => char === " ", 1);
  const collapsedTabs = collapseSourceChars(collapsedSpaces, (char) => char === "\t", 1);

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
  chars: readonly VisibleTextSourceChar[]
): readonly VisibleTextTokenWithProvenance[] {
  const tokens: VisibleTextTokenWithProvenance[] = [];
  let cursor = 0;

  while (cursor < chars.length) {
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

function tokenizeVisibleText(value: string): readonly VisibleTextToken[] {
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
}

export function visibleText(nodeOrTree: DocumentTree | FragmentTree | HtmlNode, options: VisibleTextOptions = {}): string {
  const resolvedOptions: Required<VisibleTextOptions> = {
    ...DEFAULT_VISIBLE_TEXT_OPTIONS,
    ...options
  };
  return collectVisibleText(nodeOrTree, resolvedOptions);
}

export function visibleTextTokens(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: VisibleTextOptions = {}
): readonly VisibleTextToken[] {
  const output = visibleText(nodeOrTree, options);
  return tokenizeVisibleText(output);
}

export function visibleTextTokensWithProvenance(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: VisibleTextOptions = {}
): readonly VisibleTextTokenWithProvenance[] {
  const resolvedOptions: Required<VisibleTextOptions> = {
    ...DEFAULT_VISIBLE_TEXT_OPTIONS,
    ...options
  };
  const { output, sourceChunks } = collectVisibleTextWithSourceChunks(nodeOrTree, resolvedOptions);
  const normalizedSourceChars = normalizeSourceChars(sourceChunksToChars(sourceChunks), resolvedOptions);
  const normalizedOutput = normalizedSourceChars.map((entry) => entry.char).join("");

  if (normalizedOutput !== output) {
    const fallbackSource: VisibleTextSourceChar = {
      char: "",
      sourceNodeId: null,
      sourceNodeKind: "document",
      sourceRole: "text-node"
    };
    return Object.freeze(
      tokenizeVisibleText(output).map((token) => provenanceToken(
        token.kind,
        token.value,
        token.kind === "text" ? fallbackSource : { ...fallbackSource, sourceRole: "structure-break" }
      ))
    );
  }

  return tokenizeVisibleTextWithSourceChars(normalizedSourceChars);
}

function* iterateNodes(
  nodes: readonly HtmlNode[],
  depth: number
): IterableIterator<{ readonly node: HtmlNode; readonly depth: number }> {
  for (const node of nodes) {
    yield { node, depth };
    if (node.kind === "element") {
      yield* iterateNodes(node.children, depth + 1);
    }
  }
}

export function walk(tree: DocumentTree | FragmentTree, visitor: NodeVisitor): void {
  for (const entry of iterateNodes(tree.children, 0)) {
    visitor(entry.node, entry.depth);
  }
}

export function walkElements(tree: DocumentTree | FragmentTree, visitor: ElementVisitor): void {
  for (const entry of iterateNodes(tree.children, 0)) {
    if (entry.node.kind === "element") {
      visitor(entry.node, entry.depth);
    }
  }
}

export function textContent(node: DocumentTree | FragmentTree | HtmlNode): string {
  return textContentFromNode(node);
}

export function findById(tree: DocumentTree | FragmentTree, id: NodeId): HtmlNode | null {
  for (const entry of iterateNodes(tree.children, 0)) {
    if (entry.node.id === id) {
      return entry.node;
    }
  }

  return null;
}

export function* findAllByTagName(
  tree: DocumentTree | FragmentTree,
  tagName: string
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const normalized = tagName.toLowerCase();
  for (const entry of iterateNodes(tree.children, 0)) {
    if (entry.node.kind === "element" && entry.node.tagName.toLowerCase() === normalized) {
      yield entry.node;
    }
  }
}

export function* findAllByAttr(
  tree: DocumentTree | FragmentTree,
  name: string,
  value?: string
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  for (const entry of iterateNodes(tree.children, 0)) {
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

function collectOutlineNodes(node: HtmlNode, depth: number, entries: OutlineEntry[]): void {
  if (node.kind !== "element") {
    return;
  }

  const normalized = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(normalized) || normalized === "section" || normalized === "article") {
    entries.push({
      nodeId: node.id,
      depth,
      tagName: node.tagName,
      text: textContentFromNode(node).slice(0, 200)
    });
  }

  for (const child of node.children) {
    collectOutlineNodes(child, depth + 1, entries);
  }
}

export function outline(tree: DocumentTree | FragmentTree): Outline {
  const entries: OutlineEntry[] = [];
  for (const child of tree.children) {
    collectOutlineNodes(child, 0, entries);
  }

  return { entries };
}

function countNodes(node: HtmlNode): number {
  if (node.kind !== "element") {
    return 1;
  }

  return 1 + node.children.reduce((total, child) => total + countNodes(child), 0);
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
}

export function applyPatchPlan(originalHtml: string, plan: PatchPlan): string {
  let cursor = 0;
  let output = "";

  for (const step of plan.steps) {
    if (step.kind === "slice") {
      if (step.start < cursor || step.end < step.start || step.end > originalHtml.length) {
        throw new Error("invalid patch slice bounds");
      }

      output += originalHtml.slice(step.start, step.end);
      cursor = step.end;
      continue;
    }

    if (step.at !== cursor || step.at > originalHtml.length) {
      throw new Error("invalid patch insertion offset");
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

function failPatchPlanning(payload: PatchPlanningErrorPayload): never {
  throw new PatchPlanningError(payload);
}

function requireNode(nodeById: Map<NodeId, HtmlNode>, target: NodeId): HtmlNode {
  const node = nodeById.get(target);
  if (!node) {
    failPatchPlanning({ code: "NODE_NOT_FOUND", target });
  }
  return node;
}

function requireNodeSpan(spanByNode: Map<NodeId, IndexedNodeSpan>, target: NodeId): Span {
  const indexedSpan = spanByNode.get(target);
  if (!indexedSpan) {
    failPatchPlanning({ code: "MISSING_NODE_SPAN", target });
  }
  if (indexedSpan.provenance !== "input") {
    failPatchPlanning({
      code: "NON_INPUT_SPAN_PROVENANCE",
      target,
      detail: indexedSpan.provenance
    });
  }
  if (!indexedSpan.span) {
    failPatchPlanning({ code: "MISSING_NODE_SPAN", target });
  }
  return indexedSpan.span;
}

function requireElementNode(nodeById: Map<NodeId, HtmlNode>, target: NodeId): Extract<HtmlNode, { kind: "element" }> {
  const node = requireNode(nodeById, target);
  if (node.kind !== "element") {
    failPatchPlanning({ code: "INVALID_EDIT_TARGET", target, detail: "expected element node target" });
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
      failPatchPlanning({ code: "ATTRIBUTE_SPAN_MISSING", target: edit.target, detail: edit.name });
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
    failPatchPlanning({ code: "ELEMENT_START_TAG_NOT_FOUND", target: edit.target });
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
    failPatchPlanning({ code: "ATTRIBUTE_NOT_FOUND", target: edit.target, detail: edit.name });
  }
  if (!existing.span) {
    failPatchPlanning({ code: "ATTRIBUTE_SPAN_MISSING", target: edit.target, detail: edit.name });
  }

  const elementSpan = requireNodeSpan(spanByNode, edit.target);
  const closeIndex = findElementStartTagClose(originalHtml, elementSpan);
  if (closeIndex === -1) {
    failPatchPlanning({ code: "ELEMENT_START_TAG_NOT_FOUND", target: edit.target });
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
      failPatchPlanning({ code: "INVALID_EDIT_TARGET", target: edit.target, detail: "expected text node target" });
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
}

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
      failPatchPlanning({ code: "OVERLAPPING_EDITS", target: replacement.target, detail: "invalid replacement bounds" });
    }
    if (replacement.start < previousEnd) {
      failPatchPlanning({ code: "OVERLAPPING_EDITS", target: replacement.target });
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
}

export function chunk(tree: DocumentTree | FragmentTree, options: ChunkOptions = {}): Chunk[] {
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
    const content = serialize(node);
    const nodes = countNodes(node);
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
