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

/** Inclusive, optional resource limits shared by text, byte, and fragment parsing. */
export interface ParseBudgetOptions {
  /** UTF-8 bytes for string input; transport bytes for byte and stream input. */
  readonly maxInputBytes?: number;
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
  /** Retained trace events; valid only with `trace: "events"`. */
  readonly maxTraceEvents?: number;
  /** Canonical retained-event UTF-8 bytes; valid only with `trace: "events"`. */
  readonly maxTraceBytes?: number;
  /** Elapsed milliseconds measured by the monotonic runtime clock. */
  readonly maxTimeMs?: number;
}

/** Options accepted by text, byte, and fragment parse entrypoints. */
export interface ParseOptions {
  readonly captureSpans?: boolean;
  /** Returned trace retention mode; defaults to `"none"`. */
  readonly trace?: TraceMode;
  /** Synchronously observes each immutable trace event without requiring retention. */
  readonly onTraceEvent?: TraceEventCallback;
  readonly transportEncodingLabel?: string;
  readonly budgets?: ParseBudgetOptions;
  readonly signal?: AbortSignal;
}

/** Parse limits for byte streams, including bounded encoding-prescan retention. */
export interface ParseStreamBudgetOptions extends ParseBudgetOptions {
  /** Transport bytes retained for encoding prescan; zero disables prescan retention. */
  readonly maxEncodingPrescanBytes?: number;
}

/** Options accepted by full-document byte-stream parsing. */
export interface ParseStreamOptions extends Omit<ParseOptions, "budgets"> {
  readonly budgets?: ParseStreamBudgetOptions;
}

/** Resource controls that apply to eager byte-stream decoding and tokenization. */
export type TokenizeByteStreamEagerBudgetOptions = Pick<
  ParseStreamBudgetOptions,
  | "maxInputBytes"
  | "maxEncodingPrescanBytes"
  | "maxDecodedUtf8Bytes"
  | "maxParseErrors"
  | "maxAttributesPerElement"
  | "maxAttributeBytes"
  | "maxTimeMs"
>;

/** Options accepted by eager byte-stream tokenization. */
export interface TokenizeByteStreamEagerOptions {
  readonly transportEncodingLabel?: string;
  readonly budgets?: TokenizeByteStreamEagerBudgetOptions;
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

/** Encoding decision for one parse input. */
export interface TraceDecodeEvent {
  /** One-based event order within this parse. */
  readonly seq: number;
  /** Event discriminator. */
  readonly kind: "decode";
  /** Whether text was supplied directly or decoded after sniffing. */
  readonly source: "input" | "sniff";
  /** Selected WHATWG encoding name. */
  readonly encoding: string;
  /** Evidence source that selected the encoding. */
  readonly sniffSource: "input" | "bom" | "transport" | "meta" | "default";
}

/** Logical tokenizer output count for the parse5 pass that built the tree. */
export interface TraceTokenEvent {
  /** One-based event order within this parse. */
  readonly seq: number;
  /** Event discriminator. */
  readonly kind: "token";
  /** Context-aware logical token count, including EOF. */
  readonly count: number;
}

/** Parser insertion-mode transition and the token that caused it. */
export interface TraceInsertionModeTransitionEvent {
  /** One-based event order within this parse. */
  readonly seq: number;
  /** Event discriminator. */
  readonly kind: "insertionModeTransition";
  /** Insertion mode before the transition. */
  readonly fromMode: string;
  /** Insertion mode after the transition. */
  readonly toMode: string;
  /** Immutable parser-token context for the transition. */
  readonly tokenContext: {
    /** Internal token category, or null when unavailable. */
    readonly type: string | null;
    /** Token tag name, or null for non-tag tokens. */
    readonly tagName: string | null;
    /** Inclusive source start offset, or null when unavailable. */
    readonly startOffset: number | null;
    /** Exclusive source end offset, or null when unavailable. */
    readonly endOffset: number | null;
  };
}

/** Aggregate public-tree construction result. */
export interface TraceTreeMutationEvent {
  /** One-based event order within this parse. */
  readonly seq: number;
  /** Event discriminator. */
  readonly kind: "tree-mutation";
  /** Public root plus descendant node count. */
  readonly nodeCount: number;
  /** Parser diagnostic count. */
  readonly errorCount: number;
}

/** Non-fatal HTML parse diagnostic observed during tree construction. */
export interface TraceParseErrorEvent {
  /** One-based event order within this parse. */
  readonly seq: number;
  /** Event discriminator. */
  readonly kind: "parseError";
  /** Deterministic WHATWG parse-error identifier. */
  readonly parseErrorId: string;
  /** Inclusive source start offset, or null when unavailable. */
  readonly startOffset: number | null;
  /** Exclusive source end offset, or null when unavailable. */
  readonly endOffset: number | null;
}

/** Observed value for one configured or disabled resource budget. */
export interface TraceBudgetEvent {
  /** One-based event order within this parse. */
  readonly seq: number;
  /** Event discriminator. */
  readonly kind: "budget";
  /** Public budget name. */
  readonly budget: HtmlBudgetName;
  /** Inclusive configured limit, or null when disabled. */
  readonly limit: number | null;
  /** Observed value at the trace checkpoint. */
  readonly actual: number;
  /** Whether the observed value is within the configured limit. */
  readonly status: "ok" | "exceeded";
}

/** Byte-stream consumption and encoding-prescan retention metrics. */
export interface TraceStreamEvent {
  /** One-based event order within this parse. */
  readonly seq: number;
  /** Event discriminator. */
  readonly kind: "stream";
  /** Total transport bytes read through EOF. */
  readonly bytesRead: number;
  /** Maximum transport bytes retained simultaneously for encoding prescan. */
  readonly encodingPrescanBytes: number;
  /** Effective prescan retention cap after the implementation maximum is applied. */
  readonly encodingPrescanLimitBytes: number;
}

/** Immutable structured event observed during one parse operation. */
export type TraceEvent =
  | TraceDecodeEvent
  | TraceTokenEvent
  | TraceInsertionModeTransitionEvent
  | TraceTreeMutationEvent
  | TraceParseErrorEvent
  | TraceBudgetEvent
  | TraceStreamEvent;

/** Trace retention policy for one parse operation. */
export type TraceMode = "none" | "summary" | "events";

/** Synchronous observer invoked once for each immutable trace event. */
export type TraceEventCallback = (event: TraceEvent) => void;

/** Deterministic constant-size trace counters for one parse operation. */
export interface TraceSummary {
  /** Context-aware logical token count, including EOF. */
  readonly tokenCount: number;
  /** Public root plus descendant node count. */
  readonly nodeCount: number;
  /** Maximum public tree depth, with the public root at depth one. */
  readonly maxDepth: number;
  /** Number of non-fatal parser diagnostics. */
  readonly parseErrorCount: number;
  /** Selected encoding name and the evidence source that selected it. */
  readonly encoding: {
    /** Selected WHATWG encoding name. */
    readonly name: string;
    /** Evidence source that selected the encoding. */
    readonly source: "input" | "bom" | "transport" | "meta" | "default";
  };
  /** UTF-8 bytes for text input or transport bytes for byte input. */
  readonly inputBytes: number;
  /** UTF-8 bytes in the decoded HTML text. */
  readonly decodedUtf8Bytes: number;
  /** Total stream transport bytes, or null for non-stream input. */
  readonly bytesRead: number | null;
  /** Stream encoding-prescan high-water bytes, or null for non-stream input. */
  readonly encodingPrescanBytes: number | null;
  /** Effective stream encoding-prescan cap, or null for non-stream input. */
  readonly encodingPrescanLimitBytes: number | null;
  /** Total observed event count, whether or not events were retained. */
  readonly eventCount: number;
  /** Sum of canonical event JSON UTF-8 bytes, with no delimiter. */
  readonly eventUtf8Bytes: number;
  /** Lexicographically sorted distinct observed event kinds. */
  readonly eventKinds: readonly TraceEvent["kind"][];
}

/** Returned trace data when only fixed-shape counters are retained. */
export interface TraceSummaryResult {
  /** Trace-result discriminator. */
  readonly mode: "summary";
  /** Immutable counters for the parse operation. */
  readonly summary: TraceSummary;
}

/** Returned trace data when the complete event sequence is retained. */
export interface TraceEventsResult {
  /** Trace-result discriminator. */
  readonly mode: "events";
  /** Immutable counters for the parse operation. */
  readonly summary: TraceSummary;
  /** Immutable events in sequence order. */
  readonly events: readonly TraceEvent[];
}

/** Returned deterministic trace data for summary and retained-event modes. */
export type TraceResult = TraceSummaryResult | TraceEventsResult;

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
  readonly trace?: TraceResult;
}

export interface FragmentTree {
  readonly id: NodeId;
  readonly kind: "fragment";
  readonly contextTagName: string;
  readonly children: readonly HtmlNode[];
  readonly errors: readonly ParseError[];
  readonly trace?: TraceResult;
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
  | "maxDecodedUtf8Bytes"
  | "maxNodes"
  | "maxDepth"
  | "maxParseErrors"
  | "maxAttributesPerElement"
  | "maxAttributeBytes"
  | "maxTraceEvents"
  | "maxTraceBytes"
  | "maxTimeMs";
