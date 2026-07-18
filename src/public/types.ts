/** Deterministic numeric identifier assigned to a node within one parsed tree. */
export type NodeId = number;

export type NodeKind = "document" | "fragment" | "element" | "text" | "comment" | "doctype";

export interface Span {
  readonly start: number;
  readonly end: number;
}

export type SpanProvenance = "input" | "inferred" | "none";

export interface Attribute {
  readonly name: string;
  readonly value: string;
  readonly span?: Span;
}

export interface ParseError {
  readonly code: "PARSER_ERROR";
  readonly parseErrorId: string;
  readonly message: string;
  readonly nodeId?: NodeId;
  readonly span?: Span;
}

/** Inclusive, optional resource limits for one parse operation. */
export interface BudgetOptions {
  /** UTF-8 bytes for string input; transport bytes for byte and stream input. */
  readonly maxInputBytes?: number;
  /** Bytes retained only for stream encoding prescan. */
  readonly maxBufferedBytes?: number;
  /** UTF-8 bytes produced by decoding, checked before retaining each decoded chunk. */
  readonly maxDecodedUtf8Bytes?: number;
  /** Public root plus input and parser-recovery node allocations. */
  readonly maxNodes?: number;
  /** Tree depth with the public document or fragment root at depth one. */
  readonly maxDepth?: number;
  /** Parse errors emitted while constructing the tree. */
  readonly maxParseErrors?: number;
  /** Attempted attributes on one start tag, including duplicates later discarded. */
  readonly maxAttributesPerElement?: number;
  /** UTF-8 bytes in attempted attribute names and decoded values on one start tag. */
  readonly maxAttributeBytes?: number;
  /** Trace events retained when tracing is enabled. */
  readonly maxTraceEvents?: number;
  /** Serialized trace bytes retained when tracing is enabled. */
  readonly maxTraceBytes?: number;
  /** Elapsed milliseconds measured by the monotonic runtime clock. */
  readonly maxTimeMs?: number;
}

/** Options accepted by document, byte, fragment, and stream parse entrypoints. */
export interface ParseOptions {
  readonly captureSpans?: boolean;
  readonly trace?: boolean;
  readonly transportEncodingLabel?: string;
  readonly budgets?: BudgetOptions;
  readonly signal?: AbortSignal;
}

/** Resource limits that apply to byte-stream decoding and token emission. */
export type TokenizeStreamBudgetOptions = Pick<
  BudgetOptions,
  | "maxInputBytes"
  | "maxBufferedBytes"
  | "maxDecodedUtf8Bytes"
  | "maxParseErrors"
  | "maxAttributesPerElement"
  | "maxAttributeBytes"
  | "maxTimeMs"
>;

/** Options accepted by byte-stream tokenization. */
export interface TokenizeStreamOptions {
  readonly transportEncodingLabel?: string;
  readonly budgets?: TokenizeStreamBudgetOptions;
  readonly signal?: AbortSignal;
}

/** Deadline and cancellation controls for one non-parse operation. */
export interface OperationOptions {
  /** Inclusive elapsed-time limit measured with the monotonic runtime clock. */
  readonly maxTimeMs?: number;
  /** Cancels the operation with an `HtmlAbortError` carrying this signal's reason. */
  readonly signal?: AbortSignal;
}

export interface TokenAttribute {
  readonly name: string;
  readonly value: string;
}

export interface StartTagToken {
  readonly kind: "startTag";
  readonly name: string;
  readonly attributes: readonly TokenAttribute[];
  readonly selfClosing: boolean;
}

export interface EndTagToken {
  readonly kind: "endTag";
  readonly name: string;
}

export interface CharsToken {
  readonly kind: "chars";
  readonly value: string;
}

export interface CommentToken {
  readonly kind: "comment";
  readonly value: string;
}

export interface DoctypeToken {
  readonly kind: "doctype";
  readonly name: string;
  readonly publicId: string | null;
  readonly systemId: string | null;
  readonly forceQuirks: boolean;
}

export interface EofToken {
  readonly kind: "eof";
}

export type Token =
  | StartTagToken
  | EndTagToken
  | CharsToken
  | CommentToken
  | DoctypeToken
  | EofToken;

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

export interface TraceInsertionModeTransitionEvent {
  readonly seq: number;
  readonly kind: "insertionModeTransition";
  readonly fromMode: string;
  readonly toMode: string;
  readonly tokenContext: {
    readonly type: string | null;
    readonly tagName: string | null;
    readonly startOffset: number | null;
    readonly endOffset: number | null;
  };
}

export interface TraceTreeMutationEvent {
  readonly seq: number;
  readonly kind: "tree-mutation";
  readonly nodeCount: number;
  readonly errorCount: number;
}

export interface TraceParseErrorEvent {
  readonly seq: number;
  readonly kind: "parseError";
  readonly parseErrorId: string;
  readonly startOffset: number | null;
  readonly endOffset: number | null;
}

export interface TraceBudgetEvent {
  readonly seq: number;
  readonly kind: "budget";
  readonly budget: HtmlBudgetName;
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
  | TraceInsertionModeTransitionEvent
  | TraceTreeMutationEvent
  | TraceParseErrorEvent
  | TraceBudgetEvent
  | TraceStreamEvent;

export interface TextNode {
  readonly id: NodeId;
  readonly kind: "text";
  readonly value: string;
  readonly spanProvenance: SpanProvenance;
  readonly span?: Span;
}

export interface CommentNode {
  readonly id: NodeId;
  readonly kind: "comment";
  readonly value: string;
  readonly spanProvenance: SpanProvenance;
  readonly span?: Span;
}

export interface DoctypeNode {
  readonly id: NodeId;
  readonly kind: "doctype";
  readonly name: string;
  readonly publicId?: string;
  readonly systemId?: string;
  readonly spanProvenance: SpanProvenance;
  readonly span?: Span;
}

export interface ElementNode {
  readonly id: NodeId;
  readonly kind: "element";
  readonly tagName: string;
  readonly attributes: readonly Attribute[];
  readonly children: readonly HtmlNode[];
  readonly spanProvenance: SpanProvenance;
  readonly span?: Span;
}

export type HtmlNode = ElementNode | TextNode | CommentNode | DoctypeNode;

export type NodeVisitor = (node: HtmlNode, depth: number) => void;
export type ElementVisitor = (node: ElementNode, depth: number) => void;

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

export interface ChunkOptions extends OperationOptions {
  readonly maxChars?: number;
  readonly maxNodes?: number;
  readonly maxBytes?: number;
}

export interface VisibleTextOptions extends OperationOptions {
  readonly skipHiddenSubtrees?: boolean;
  readonly includeControlValues?: boolean;
  readonly includeAccessibleNameFallback?: boolean;
  readonly trim?: boolean;
}

export type VisibleTextTokenSourceRole =
  | "text-node"
  | "img-alt"
  | "input-value"
  | "input-aria-label"
  | "button-value"
  | "structure-break"
  | "noscript-fallback";

export type VisibleTextTokenSourceNodeKind = NodeKind | "document" | "fragment";

export interface VisibleTextTokenProvenance {
  readonly sourceNodeId: NodeId | null;
  readonly sourceNodeKind: VisibleTextTokenSourceNodeKind;
  readonly sourceRole: VisibleTextTokenSourceRole;
}

export interface VisibleTextTextToken {
  readonly kind: "text";
  readonly value: string;
}

export interface VisibleTextLineBreakToken {
  readonly kind: "lineBreak";
  readonly value: "\n";
}

export interface VisibleTextParagraphBreakToken {
  readonly kind: "paragraphBreak";
  readonly value: "\n\n";
}

export interface VisibleTextTabToken {
  readonly kind: "tab";
  readonly value: "\t";
}

export type VisibleTextToken =
  | VisibleTextTextToken
  | VisibleTextLineBreakToken
  | VisibleTextParagraphBreakToken
  | VisibleTextTabToken;

export type VisibleTextTokenWithProvenance =
  | (VisibleTextTextToken & VisibleTextTokenProvenance)
  | (VisibleTextLineBreakToken & VisibleTextTokenProvenance)
  | (VisibleTextParagraphBreakToken & VisibleTextTokenProvenance)
  | (VisibleTextTabToken & VisibleTextTokenProvenance);

export interface RemoveNodeEdit {
  readonly kind: "removeNode";
  readonly target: NodeId;
}

export interface ReplaceTextEdit {
  readonly kind: "replaceText";
  readonly target: NodeId;
  readonly value: string;
}

export interface SetAttrEdit {
  readonly kind: "setAttr";
  readonly target: NodeId;
  readonly name: string;
  readonly value: string;
}

export interface RemoveAttrEdit {
  readonly kind: "removeAttr";
  readonly target: NodeId;
  readonly name: string;
}

export interface InsertHtmlBeforeEdit {
  readonly kind: "insertHtmlBefore";
  readonly target: NodeId;
  readonly html: string;
}

export interface InsertHtmlAfterEdit {
  readonly kind: "insertHtmlAfter";
  readonly target: NodeId;
  readonly html: string;
}

export type Edit =
  | RemoveNodeEdit
  | ReplaceTextEdit
  | SetAttrEdit
  | RemoveAttrEdit
  | InsertHtmlBeforeEdit
  | InsertHtmlAfterEdit;

/** Machine-readable reasons for rejecting parser configuration. */
export type HtmlConfigurationErrorReason =
  | "UNKNOWN_OPTION"
  | "INVALID_VALUE"
  | "CONFLICTING_OPTIONS";

/** Machine-readable reasons a structural patch cannot be planned or applied. */
export type HtmlPatchPlanningReason =
  | "NODE_NOT_FOUND"
  | "MISSING_NODE_SPAN"
  | "NON_INPUT_SPAN_PROVENANCE"
  | "INVALID_EDIT_TARGET"
  | "ATTRIBUTE_NOT_FOUND"
  | "ATTRIBUTE_SPAN_MISSING"
  | "ELEMENT_START_TAG_NOT_FOUND"
  | "OVERLAPPING_EDITS"
  | "INVALID_PLAN_SLICE"
  | "INVALID_PLAN_INSERTION";

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

/** Names of public resource budgets reported by budget failures and trace events. */
export type HtmlBudgetName =
  | "maxInputBytes"
  | "maxBufferedBytes"
  | "maxDecodedUtf8Bytes"
  | "maxNodes"
  | "maxDepth"
  | "maxParseErrors"
  | "maxAttributesPerElement"
  | "maxAttributeBytes"
  | "maxTraceEvents"
  | "maxTraceBytes"
  | "maxTimeMs";
