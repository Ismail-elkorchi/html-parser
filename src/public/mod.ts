import { decodeHtmlBytes } from "../internal/encoding/mod.js";

import type {
  Attribute,
  BudgetExceededPayload,
  Chunk,
  ChunkOptions,
  DocumentTree,
  ElementNode,
  FragmentTree,
  HtmlNode,
  NodeId,
  Outline,
  OutlineEntry,
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
  ParseError,
  ParseOptions,
  Span,
  TextNode,
  TraceEvent
} from "./types.js";

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

function normalizeAttributes(attributes: readonly Attribute[]): readonly Attribute[] {
  return [...attributes].sort((left, right) => left.name.localeCompare(right.name));
}

function withSpan(includeSpans: boolean, start: number, end: number): Span | undefined {
  if (!includeSpans) {
    return undefined;
  }

  return { start, end };
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
  return event.detail.length + event.stage.length + 24;
}

function pushTrace(
  trace: TraceEvent[] | undefined,
  stage: TraceEvent["stage"],
  detail: string,
  budgets: ParseOptions["budgets"] | undefined
): TraceEvent[] | undefined {
  if (!trace) {
    return undefined;
  }

  const next = [...trace, { seq: trace.length + 1, stage, detail }];
  enforceBudget("maxTraceEvents", budgets?.maxTraceEvents, next.length);

  const bytes = next.reduce((total, item) => total + eventSize(item), 0);
  enforceBudget("maxTraceBytes", budgets?.maxTraceBytes, bytes);

  return next;
}

function buildTrace(enabled: boolean | undefined, budgets: ParseOptions["budgets"]): TraceEvent[] | undefined {
  if (!enabled) {
    return undefined;
  }

  const base: TraceEvent[] = [
    { seq: 1, stage: "decode", detail: "input received" },
    { seq: 2, stage: "tokenize", detail: "stub tokenization" },
    { seq: 3, stage: "tree", detail: "stub tree construction" }
  ];

  enforceBudget("maxTraceEvents", budgets?.maxTraceEvents, base.length);
  const bytes = base.reduce((total, item) => total + eventSize(item), 0);
  enforceBudget("maxTraceBytes", budgets?.maxTraceBytes, bytes);

  return base;
}

function parseAsDocument(html: string, options: ParseOptions = {}): DocumentTree {
  const startedAt = Date.now();
  const assigner = new NodeIdAssigner();
  const includeSpans = options.includeSpans ?? false;
  const budgets = options.budgets;
  let trace = buildTrace(options.trace, budgets);
  const textSpan = withSpan(includeSpans, 0, html.length);
  const rootSpan = withSpan(includeSpans, 0, html.length);

  enforceBudget("maxInputBytes", budgets?.maxInputBytes, html.length);

  const textNode: HtmlNode = {
    id: assigner.next(),
    kind: "text",
    value: html,
    ...(textSpan ? { span: textSpan } : {})
  };

  const htmlElement: ElementNode = {
    id: assigner.next(),
    kind: "element",
    tagName: "html",
    attributes: normalizeAttributes([]),
    children: [textNode],
    ...(rootSpan ? { span: rootSpan } : {})
  };

  trace = pushTrace(trace, "tree", "document wrapped in html element", budgets);

  const documentTree: DocumentTree = {
    id: assigner.next(),
    kind: "document",
    children: [htmlElement],
    errors: [],
    ...(trace ? { trace } : {})
  };

  enforceBudget("maxNodes", budgets?.maxNodes, 3);
  enforceBudget("maxDepth", budgets?.maxDepth, 2);
  enforceBudget("maxTimeMs", budgets?.maxTimeMs, Date.now() - startedAt);

  return documentTree;
}

export function parse(html: string, options: ParseOptions = {}): DocumentTree {
  return parseAsDocument(html, options);
}

export function parseBytes(bytes: Uint8Array, options: ParseOptions = {}): DocumentTree {
  const decoded = decodeHtmlBytes(
    bytes,
    options.transportEncodingLabel
      ? { transportEncodingLabel: options.transportEncodingLabel }
      : {}
  );
  return parseAsDocument(decoded.text, options);
}

export function parseFragment(
  html: string,
  contextTagName: string,
  options: ParseOptions = {}
): FragmentTree {
  const startedAt = Date.now();
  const normalizedContext = contextTagName.trim().toLowerCase();
  if (normalizedContext.length === 0) {
    throw new Error("contextTagName must be a non-empty tag name");
  }

  const assigner = new NodeIdAssigner();
  const includeSpans = options.includeSpans ?? false;
  const budgets = options.budgets;
  let trace = buildTrace(options.trace, budgets);
  const textSpan = withSpan(includeSpans, 0, html.length);
  const rootSpan = withSpan(includeSpans, 0, html.length);

  enforceBudget("maxInputBytes", budgets?.maxInputBytes, html.length);

  const contextNamespace =
    normalizedContext === "svg"
      ? "svg"
      : normalizedContext === "math" || normalizedContext === "mathml"
        ? "mathml"
        : "html";

  trace = pushTrace(trace, "fragment", `fragment-context:${contextNamespace}:${normalizedContext}`, budgets);

  const textNode: HtmlNode = {
    id: assigner.next(),
    kind: "text",
    value: html,
    ...(textSpan ? { span: textSpan } : {})
  };

  const contextElement: ElementNode = {
    id: assigner.next(),
    kind: "element",
    tagName: contextNamespace === "html" ? normalizedContext : `${contextNamespace}:${normalizedContext}`,
    attributes: normalizeAttributes([]),
    children: [textNode],
    ...(rootSpan ? { span: rootSpan } : {})
  };

  const fragmentTree: FragmentTree = {
    id: assigner.next(),
    kind: "fragment",
    contextTagName: normalizedContext,
    children: [contextElement],
    errors: [],
    ...(trace ? { trace } : {})
  };

  enforceBudget("maxNodes", budgets?.maxNodes, 3);
  enforceBudget("maxDepth", budgets?.maxDepth, 2);
  enforceBudget("maxTimeMs", budgets?.maxTimeMs, Date.now() - startedAt);

  return fragmentTree;
}

export async function parseStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseOptions = {}
): Promise<DocumentTree> {
  const startedAt = Date.now();
  const budgets = options.budgets;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let buffered = 0;

  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }

    const chunk = next.value;
    chunks.push(chunk);
    total += chunk.byteLength;
    buffered += chunk.byteLength;

    enforceBudget("maxInputBytes", budgets?.maxInputBytes, total);
    enforceBudget("maxBufferedBytes", budgets?.maxBufferedBytes, buffered);
    enforceBudget("maxTimeMs", budgets?.maxTimeMs, Date.now() - startedAt);
  }

  const combined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const parsed = parseBytes(combined, options);

  if (parsed.trace) {
    const withStream = pushTrace([...parsed.trace], "stream", "stream-read-complete", budgets);
    if (withStream) {
      return { ...parsed, trace: withStream };
    }
  }

  return parsed;
}

function serializeNode(node: HtmlNode): string {
  if (node.kind === "text") {
    return node.value;
  }

  if (node.kind === "comment") {
    return `<!--${node.value}-->`;
  }

  if (node.kind === "doctype") {
    return `<!doctype ${node.name}>`;
  }

  const attr = node.attributes
    .map((item) => `${item.name}="${item.value}"`)
    .join(" ");

  const open = attr.length > 0 ? `<${node.tagName} ${attr}>` : `<${node.tagName}>`;
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

export function chunk(tree: DocumentTree | FragmentTree, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? 8192;
  const maxNodes = options.maxNodes ?? 256;
  const chunks: Chunk[] = [];
  let activeContent = "";
  let activeNodes = 0;
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
    activeNodeId = null;
  };

  for (const node of tree.children) {
    const content = serialize(node);
    const nodes = countNodes(node);

    const nextChars = activeContent.length + content.length;
    const nextNodes = activeNodes + nodes;
    if (activeNodeId !== null && (nextChars > maxChars || nextNodes > maxNodes)) {
      flush();
    }

    if (activeNodeId === null) {
      activeNodeId = node.id;
    }
    activeContent += content;
    activeNodes += nodes;
  }

  flush();
  return chunks;
}
