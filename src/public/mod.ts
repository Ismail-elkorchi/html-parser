import { decodeHtmlBytes, sniffHtmlEncoding } from "../internal/encoding/mod.js";
import { tokenize, type TokenizerBudgets } from "../internal/tokenizer/mod.js";
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
  FragmentTree,
  HtmlNode,
  NodeId,
  Outline,
  OutlineEntry,
  PatchEdit,
  PatchPlan,
  PatchStep,
  ParseError,
  ParseOptions,
  Span,
  TraceEvent
} from "./types.js";

export type {
  Attribute,
  BudgetOptions,
  BudgetExceededPayload,
  Chunk,
  ChunkOptions,
  CommentNode,
  DocumentTree,
  DoctypeNode,
  ElementNode,
  FragmentTree,
  HtmlNode,
  NodeId,
  NodeKind,
  Outline,
  OutlineEntry,
  PatchEdit,
  PatchInsertStep,
  PatchPlan,
  PatchSliceStep,
  PatchStep,
  ParseError,
  ParseOptions,
  Span,
  TextNode,
  TraceEvent
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
    return {
      code: "PARSER_ERROR",
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
    return {
      id: assigner.next(),
      kind: "text",
      value: node.value,
      ...(span ? { span } : {})
    };
  }

  if (node.kind === "comment") {
    const span = toPublicSpan(node.span, captureSpans);
    return {
      id: assigner.next(),
      kind: "comment",
      value: node.value,
      ...(span ? { span } : {})
    };
  }

  if (node.kind === "doctype") {
    const span = toPublicSpan(node.span, captureSpans);
    return {
      id: assigner.next(),
      kind: "doctype",
      name: node.name,
      ...(node.publicId.length > 0 ? { publicId: node.publicId } : {}),
      ...(node.systemId.length > 0 ? { systemId: node.systemId } : {}),
      ...(span ? { span } : {})
    };
  }

  const span = toPublicSpan(node.span, captureSpans);
  const children = node.children.map((child) => convertTreeNode(child, assigner, captureSpans));
  const attributes = normalizeAttributes(toAttributes(node.attributes, captureSpans));

  return {
    id: assigner.next(),
    kind: "element",
    tagName: toPublicTagName(node.name),
    attributes,
    children,
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
      parseErrorId: treeError.code,
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
      parseErrorId: treeError.code,
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

export async function parseStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseOptions = {}
): Promise<DocumentTree> {
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

  const parsed = parse(decodedParts.join(""), options);
  if (!parsed.trace) {
    return parsed;
  }

  let trace = [...parsed.trace];
  trace = pushTrace(trace, {
    kind: "decode",
    source: "sniff",
    encoding: sniff.encoding,
    sniffSource: sniff.source
  }, budgets) ?? trace;
  trace = pushTrace(trace, {
    kind: "stream",
    bytesRead: total
  }, budgets) ?? trace;
  trace = pushBudgetTrace(trace, "maxBufferedBytes", budgets?.maxBufferedBytes, maxBufferedObserved, budgets) ?? trace;

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

function extractText(node: HtmlNode): string {
  if (node.kind === "text") {
    return node.value;
  }

  if (node.kind !== "element") {
    return "";
  }

  return node.children.map((child) => extractText(child)).join("");
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
      text: extractText(node).slice(0, 200)
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

function indexNodeSpans(nodes: readonly HtmlNode[], into: Map<NodeId, Span>): void {
  for (const node of nodes) {
    if (node.span) {
      into.set(node.id, node.span);
    }

    if (node.kind === "element") {
      indexNodeSpans(node.children, into);
    }
  }
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
  readonly nodeId: NodeId;
  readonly start: number;
  readonly end: number;
  readonly replacementHtml: string;
}

export function computePatch(originalHtml: string, edits: readonly PatchEdit[]): PatchPlan {
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
  const spanByNode = new Map<NodeId, Span>();
  indexNodeSpans(parsed.children, spanByNode);

  const replacements: PlannedReplacement[] = [];
  const seenNodeIds = new Set<NodeId>();
  for (const edit of edits) {
    if (seenNodeIds.has(edit.nodeId)) {
      throw new Error(`duplicate patch edit for nodeId ${String(edit.nodeId)}`);
    }

    seenNodeIds.add(edit.nodeId);
    const span = spanByNode.get(edit.nodeId);
    if (!span) {
      throw new Error(`cannot patch nodeId ${String(edit.nodeId)} without captured span`);
    }

    replacements.push({
      nodeId: edit.nodeId,
      start: span.start,
      end: span.end,
      replacementHtml: edit.replacementHtml
    });
  }

  replacements.sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }

    if (left.end !== right.end) {
      return left.end - right.end;
    }

    return left.nodeId - right.nodeId;
  });

  let previousEnd = -1;
  for (const replacement of replacements) {
    if (replacement.start < previousEnd) {
      throw new Error("overlapping patch edits are not allowed");
    }

    previousEnd = replacement.end;
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
