/** Deterministic numeric identifier assigned to a node within one parsed tree. */
export type NodeId = number;

export type NodeKind = "document" | "fragment" | "element" | "text" | "comment" | "doctype";

export interface Span {
  /** Zero-based UTF-16 code-unit offset into the decoded input, inclusive. */
  readonly start: number;
  /** Zero-based UTF-16 code-unit offset into the decoded input, exclusive. */
  readonly end: number;
}

export type SpanProvenance = "input" | "inferred" | "none";

export interface Attribute {
  /** Namespace URI, or null for an unnamespaced attribute. */
  readonly namespaceUri: string | null;
  /** Namespace prefix, or null when the attribute is unprefixed. */
  readonly prefix: string | null;
  /** Local name supplied by the HTML tree builder. */
  readonly localName: string;
  /** Qualified name, including the prefix when one exists. */
  readonly name: string;
  readonly value: string;
  /** Full source span of the attribute, including its name and value syntax. */
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

/** Decoded-source retention for a full-document parse result. */
export type SourceRetention = "none" | "text";

/** Options accepted by already-decoded full-document text parsing. */
export interface ParseOptions {
  readonly captureSpans?: boolean;
  /** Exact decoded source retention; defaults to `"none"`. */
  readonly sourceRetention?: SourceRetention;
  /** Returned trace retention mode; defaults to `"none"`. */
  readonly trace?: TraceMode;
  /** Synchronously observes each immutable trace event without requiring retention. */
  readonly onTraceEvent?: TraceEventCallback;
  readonly budgets?: ParseBudgetOptions;
  readonly signal?: AbortSignal;
}

/** Options accepted by full-document byte parsing. */
export interface ParseBytesOptions extends ParseOptions {
  /** Optional transport encoding label considered during HTML encoding sniffing. */
  readonly transportEncodingLabel?: string;
}

/** Options accepted by already-decoded fragment parsing. */
export type ParseFragmentOptions = Omit<ParseOptions, "sourceRetention">;

/** Parse limits for byte streams, including bounded encoding-prescan retention. */
export interface ParseStreamBudgetOptions extends ParseBudgetOptions {
  /** Transport bytes retained for encoding prescan; zero disables prescan retention. */
  readonly maxEncodingPrescanBytes?: number;
}

/** Options accepted by full-document byte-stream parsing. */
export interface ParseStreamOptions extends Omit<ParseBytesOptions, "budgets"> {
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

/** External identifier syntax retained from a document type declaration. */
export type DoctypeExternalId =
  | { readonly kind: "none" }
  | {
      readonly kind: "public";
      readonly publicId: string;
      readonly systemId: string | null;
    }
  | { readonly kind: "system"; readonly systemId: string };

export interface DoctypeNode {
  readonly id: NodeId;
  readonly kind: "doctype";
  readonly name: string;
  readonly externalId: DoctypeExternalId;
  readonly spanProvenance: SpanProvenance;
  readonly span?: Span;
}

export interface ElementNode {
  readonly id: NodeId;
  readonly kind: "element";
  /** Namespace URI assigned by the HTML tree builder. */
  readonly namespaceUri: string;
  /** Namespace prefix, or null when the parser did not provide one. */
  readonly prefix: string | null;
  /** Local element name supplied by the HTML tree builder. */
  readonly localName: string;
  /** Qualified element name, including the prefix when one exists. */
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

/** Successful full-document parser resource observations. */
export interface ParseResourceUsage {
  /** UTF-8 bytes for text input; supplied transport bytes for byte/stream input. */
  readonly inputBytes: number;
  /** UTF-8 bytes in the exact decoded source. */
  readonly decodedUtf8Bytes: number;
  /** UTF-16 code units in the exact decoded source. */
  readonly decodedCodeUnits: number;
  /** Public root plus all input and recovery allocations counted by `maxNodes`. */
  readonly nodes: number;
  /** Highest parser-assigned depth, with the public root at depth one. */
  readonly maxDepth: number;
  /** Parse diagnostics emitted while constructing the tree. */
  readonly parseErrors: number;
  /** Attempted start-tag attributes, including duplicates later discarded. */
  readonly attributes: number;
  /** UTF-8 bytes in attempted attribute names and decoded values. */
  readonly attributeUtf8Bytes: number;
  /** Stream encoding-prescan retained-byte high-water mark; zero otherwise. */
  readonly encodingPrescanBytes: number;
  /** Observable trace events emitted; zero when tracing and observation are disabled. */
  readonly traceEvents: number;
  /** Canonical UTF-8 event bytes accounted in summary/event trace modes. */
  readonly traceUtf8Bytes: number;
}

/** Encoding evidence produced by the same pipeline that built the tree. */
export interface ParseEncodingMetadata {
  /** Selected encoding, or null for already-decoded text input. */
  readonly name: string | null;
  /** Evidence that selected the encoding. */
  readonly source: "already-decoded" | "bom" | "transport" | "meta" | "default";
}

/** Deterministic metadata for one full-document parse. */
export interface ParsedDocumentMetadata {
  /** Public input variant used for this parse. */
  readonly inputKind: "text" | "bytes" | "stream";
  /** Bytes supplied to a byte/stream API, or null for already-decoded text. */
  readonly transportByteLength: number | null;
  /** Encoding decision from the owning parse pipeline. */
  readonly encoding: ParseEncodingMetadata;
  /** Successful deterministic resource observations. */
  readonly resourceUsage: ParseResourceUsage;
}

/** Canonical result returned by every full-document parse entrypoint. */
export interface ParsedDocument {
  /** Parsed document tree. */
  readonly tree: DocumentTree;
  /** Exact decoded input when `sourceRetention: "text"`; otherwise null. */
  readonly sourceText: string | null;
  /** Input, encoding, and resource evidence from this parse. */
  readonly metadata: ParsedDocumentMetadata;
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

/** Versioned semantic policy selected for bounded text extraction. */
export type TextExtractionPolicy = "visible-text-html-v1" | "text-content-v1";

/** Resource controls required by every bounded text extraction. */
export interface TextExtractionOptionsBase extends OperationOptions {
  /** Semantic policy to apply. */
  readonly policy: TextExtractionPolicy;
  /** Maximum canonical UTF-8 bytes retained in returned text. */
  readonly maxOutputBytes: number;
  /** Maximum policy tokens retained and yielded. */
  readonly maxTokens: number;
}

/** Options for the versioned visible-text policy. */
export interface VisibleTextExtractionOptions extends TextExtractionOptionsBase {
  /** Stable visible-text policy identity. */
  readonly policy: "visible-text-html-v1";
  /** Maximum UTF-8 bytes reparsed for one `noscript` fallback. */
  readonly maxFallbackInputBytes: number;
  /** Maximum nodes allocated by one `noscript` fallback parse. */
  readonly maxFallbackNodes: number;
  /** Skip hidden or non-visible subtrees; defaults to true. */
  readonly skipHiddenSubtrees?: boolean;
  /** Include values from control-like nodes; defaults to true. */
  readonly includeControlValues?: boolean;
  /** Include limited accessible-name fallback sources; defaults to false. */
  readonly includeAccessibleNameFallback?: boolean;
  /** Trim final policy output; defaults to true. */
  readonly trim?: boolean;
}

/** Options for bounded DOM text-content concatenation. */
export interface TextContentExtractionOptions extends TextExtractionOptionsBase {
  /** Stable raw text-content policy identity. */
  readonly policy: "text-content-v1";
}

/** Closed policy-discriminated options accepted by text extraction. */
export type TextExtractionOptions =
  | VisibleTextExtractionOptions
  | TextContentExtractionOptions;

/** Immutable bounded text result with exact untruncated UTF-8 measurement. */
export interface TextExtractionResult {
  /** Retained scalar-safe output prefix. */
  readonly text: string;
  /** Canonical UTF-8 bytes in the complete policy output. */
  readonly totalBytes: number;
  /** Whether a byte or token cap omitted output. */
  readonly truncated: boolean;
  /** Semantic policy that produced the result. */
  readonly policy: TextExtractionPolicy;
}

/** Source role represented by one extraction provenance range. */
export type TextExtractionSourceRole =
  | "text-node"
  | "img-alt"
  | "input-value"
  | "input-aria-label"
  | "button-value"
  | "structure-break"
  | "noscript-fallback";

/** Parsed source-node kind represented by extraction provenance. */
export type TextExtractionSourceNodeKind = NodeKind | "document" | "fragment";

/** Coalesced provenance for a half-open UTF-8 range in retained output. */
export interface TextProvenanceRange {
  /** Inclusive retained-output byte offset. */
  readonly outputByteStart: number;
  /** Exclusive retained-output byte offset. */
  readonly outputByteEnd: number;
  /** Parsed source node, or null when no node can be identified. */
  readonly sourceNodeId: NodeId | null;
  /** Parsed source-node kind. */
  readonly sourceNodeKind: TextExtractionSourceNodeKind;
  /** Semantic role by which the source contributed output. */
  readonly sourceRole: TextExtractionSourceRole;
}

/** Token kinds emitted by the bounded extraction iterator. */
export type TextExtractionTokenKind = "text" | "lineBreak" | "paragraphBreak" | "tab";

/** One retained policy token with bounded, range-based source provenance. */
export interface TextExtractionToken {
  /** Token category after policy normalization. */
  readonly kind: TextExtractionTokenKind;
  /** Retained token text. */
  readonly value: string;
  /** Semantic policy that produced the token. */
  readonly policy: TextExtractionPolicy;
  /** Inclusive token offset in retained-output UTF-8 bytes. */
  readonly outputByteStart: number;
  /** Exclusive token offset in retained-output UTF-8 bytes. */
  readonly outputByteEnd: number;
  /** Coalesced source ranges covering the complete token. */
  readonly provenance: readonly TextProvenanceRange[];
}

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
  | "UNRECOGNIZED_PARSED_DOCUMENT"
  | "SOURCE_NOT_RETAINED"
  | "SPANS_NOT_CAPTURED"
  | "PLAN_SOURCE_MISMATCH"
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
  | "maxFallbackInputBytes"
  | "maxFallbackNodes"
  | "maxTimeMs";
