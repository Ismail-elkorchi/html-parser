export type NodeId = number;

export type NodeKind = "document" | "fragment" | "element" | "text" | "comment" | "doctype";

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface Attribute {
  readonly name: string;
  readonly value: string;
  readonly span?: Span;
}

export interface ParseError {
  readonly code:
    | "BUDGET_EXCEEDED"
    | "STREAM_READ_FAILED"
    | "UNSUPPORTED_ENCODING"
    | "INVALID_FRAGMENT_CONTEXT"
    | "PARSER_ERROR";
  readonly message: string;
  readonly nodeId?: NodeId;
  readonly span?: Span;
}

export interface BudgetOptions {
  readonly maxInputBytes?: number;
  readonly maxBufferedBytes?: number;
  readonly maxNodes?: number;
  readonly maxDepth?: number;
  readonly maxTraceEvents?: number;
  readonly maxTraceBytes?: number;
  readonly maxTimeMs?: number;
}

export interface ParseOptions {
  readonly captureSpans?: boolean;
  readonly includeSpans?: boolean;
  readonly trace?: boolean;
  readonly transportEncodingLabel?: string;
  readonly budgets?: BudgetOptions;
}

export interface TraceDecodeEvent {
  readonly seq: number;
  readonly kind: "decode";
  readonly source: "input" | "sniff";
  readonly encoding: string;
  readonly sniffSource: "input" | "bom" | "transport" | "meta" | "default";
}

export interface TraceTokenEvent {
  readonly seq: number;
  readonly kind: "token";
  readonly count: number;
}

export interface TraceInsertionModeEvent {
  readonly seq: number;
  readonly kind: "insertion-mode";
  readonly mode: "document-start" | "fragment-start" | "after-tree";
}

export interface TraceTreeMutationEvent {
  readonly seq: number;
  readonly kind: "tree-mutation";
  readonly nodeCount: number;
  readonly errorCount: number;
}

export interface TraceParseErrorEvent {
  readonly seq: number;
  readonly kind: "parse-error";
  readonly code: string;
}

export interface TraceBudgetEvent {
  readonly seq: number;
  readonly kind: "budget";
  readonly budget: BudgetExceededPayload["budget"];
  readonly limit: number | null;
  readonly actual: number;
  readonly status: "ok" | "exceeded";
}

export interface TraceStreamEvent {
  readonly seq: number;
  readonly kind: "stream";
  readonly bytesRead: number;
}

export type TraceEvent =
  | TraceDecodeEvent
  | TraceTokenEvent
  | TraceInsertionModeEvent
  | TraceTreeMutationEvent
  | TraceParseErrorEvent
  | TraceBudgetEvent
  | TraceStreamEvent;

export interface TextNode {
  readonly id: NodeId;
  readonly kind: "text";
  readonly value: string;
  readonly span?: Span;
}

export interface CommentNode {
  readonly id: NodeId;
  readonly kind: "comment";
  readonly value: string;
  readonly span?: Span;
}

export interface DoctypeNode {
  readonly id: NodeId;
  readonly kind: "doctype";
  readonly name: string;
  readonly publicId?: string;
  readonly systemId?: string;
  readonly span?: Span;
}

export interface ElementNode {
  readonly id: NodeId;
  readonly kind: "element";
  readonly tagName: string;
  readonly attributes: readonly Attribute[];
  readonly children: readonly HtmlNode[];
  readonly span?: Span;
}

export type HtmlNode = ElementNode | TextNode | CommentNode | DoctypeNode;

export interface DocumentTree {
  readonly id: NodeId;
  readonly kind: "document";
  readonly children: readonly HtmlNode[];
  readonly errors: readonly ParseError[];
  readonly trace?: readonly TraceEvent[];
}

export interface FragmentTree {
  readonly id: NodeId;
  readonly kind: "fragment";
  readonly contextTagName: string;
  readonly children: readonly HtmlNode[];
  readonly errors: readonly ParseError[];
  readonly trace?: readonly TraceEvent[];
}

export interface OutlineEntry {
  readonly nodeId: NodeId;
  readonly depth: number;
  readonly tagName: string;
  readonly text: string;
}

export interface Outline {
  readonly entries: readonly OutlineEntry[];
}

export interface Chunk {
  readonly index: number;
  readonly nodeId: NodeId;
  readonly content: string;
  readonly nodes: number;
}

export interface ChunkOptions {
  readonly maxChars?: number;
  readonly maxNodes?: number;
}

export interface PatchEdit {
  readonly nodeId: NodeId;
  readonly replacementHtml: string;
}

export interface PatchSliceStep {
  readonly kind: "slice";
  readonly start: number;
  readonly end: number;
}

export interface PatchInsertStep {
  readonly kind: "insert";
  readonly at: number;
  readonly text: string;
}

export type PatchStep = PatchSliceStep | PatchInsertStep;

export interface PatchPlan {
  readonly steps: readonly PatchStep[];
  readonly result: string;
}

export interface BudgetExceededPayload {
  readonly code: "BUDGET_EXCEEDED";
  readonly budget:
    | "maxInputBytes"
    | "maxBufferedBytes"
    | "maxNodes"
    | "maxDepth"
    | "maxTraceEvents"
    | "maxTraceBytes"
    | "maxTimeMs";
  readonly limit: number;
  readonly actual: number;
}
