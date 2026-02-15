import { decodeHtmlBytes } from "../internal/encoding/mod.js";

import type {
  Attribute,
  BudgetExceededPayload,
  Chunk,
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
  budget: "maxInputBytes" | "maxNodes" | "maxTraceEvents",
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

function buildTrace(enabled: boolean | undefined, maxTraceEvents: number | undefined): TraceEvent[] | undefined {
  if (!enabled) {
    return undefined;
  }

  const trace: TraceEvent[] = [
    { seq: 1, stage: "decode", detail: "input received" },
    { seq: 2, stage: "tokenize", detail: "stub tokenization" },
    { seq: 3, stage: "tree", detail: "stub tree construction" }
  ];

  enforceBudget("maxTraceEvents", maxTraceEvents, trace.length);
  return trace;
}

function parseAsDocument(html: string, options: ParseOptions = {}): DocumentTree {
  const assigner = new NodeIdAssigner();
  const includeSpans = options.includeSpans ?? false;
  const trace = buildTrace(options.trace, options.budgets?.maxTraceEvents);
  const textSpan = withSpan(includeSpans, 0, html.length);
  const rootSpan = withSpan(includeSpans, 0, html.length);

  enforceBudget("maxInputBytes", options.budgets?.maxInputBytes, html.length);

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

  const documentTree: DocumentTree = {
    id: assigner.next(),
    kind: "document",
    children: [htmlElement],
    errors: [],
    ...(trace ? { trace } : {})
  };

  enforceBudget("maxNodes", options.budgets?.maxNodes, 3);

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
  const normalizedContext = contextTagName.trim().toLowerCase();
  if (normalizedContext.length === 0) {
    throw new Error("contextTagName must be a non-empty tag name");
  }

  const assigner = new NodeIdAssigner();
  const includeSpans = options.includeSpans ?? false;
  const trace = buildTrace(options.trace, options.budgets?.maxTraceEvents);
  const textSpan = withSpan(includeSpans, 0, html.length);
  const rootSpan = withSpan(includeSpans, 0, html.length);

  enforceBudget("maxInputBytes", options.budgets?.maxInputBytes, html.length);

  const textNode: HtmlNode = {
    id: assigner.next(),
    kind: "text",
    value: html,
    ...(textSpan ? { span: textSpan } : {})
  };

  const contextElement: ElementNode = {
    id: assigner.next(),
    kind: "element",
    tagName: normalizedContext,
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

  enforceBudget("maxNodes", options.budgets?.maxNodes, 3);

  return fragmentTree;
}

export async function parseStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseOptions = {}
): Promise<DocumentTree> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }

    const chunk = next.value;
    chunks.push(chunk);
    total += chunk.byteLength;
    enforceBudget("maxInputBytes", options.budgets?.maxInputBytes, total);
  }

  const combined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return parseBytes(combined, options);
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

function collectOutlineNodes(node: HtmlNode, depth: number, entries: OutlineEntry[]): void {
  if (node.kind !== "element") {
    return;
  }

  entries.push({
    nodeId: node.id,
    depth,
    tagName: node.tagName
  });

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

export function chunk(tree: DocumentTree | FragmentTree): Chunk[] {
  return tree.children.map((node, index) => ({
    index,
    nodeId: node.id,
    content: serialize(node)
  }));
}
