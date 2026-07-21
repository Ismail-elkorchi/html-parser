/** Deterministic numeric identifier assigned to a node within one parsed tree. */
export type NodeId = number;

/** Discriminator values used by public document, fragment, and node records. */
export type NodeKind =
  | "document"
  | "fragment"
  | "templateContent"
  | "element"
  | "text"
  | "comment"
  | "processingInstruction"
  | "doctype";

/** Half-open UTF-16 source range in decoded input. */
export interface Span {
  /** Zero-based UTF-16 code-unit offset into the decoded input, inclusive. */
  readonly start: number;
  /** Zero-based UTF-16 code-unit offset into the decoded input, exclusive. */
  readonly end: number;
}

/** Describes whether a captured node span came from input or parser inference. */
export type SpanProvenance = "input" | "inferred";

/** Immutable parsed attribute with namespace and optional source information. */
export interface Attribute {
  /** Namespace URI, or null for an unnamespaced attribute. */
  readonly namespaceUri: HtmlAttributeNamespaceUri;
  /** Local name supplied by the HTML tree builder. */
  readonly localName: string;
  /** Decoded attribute value. */
  readonly value: string;
  /** Full source span of the attribute, including its name and value syntax. */
  readonly span?: Span;
}

/** Non-fatal HTML syntax error reported while constructing a tree. */
export interface ParseError {
  /** Stable public error category. */
  readonly code: "PARSER_ERROR";
  /** HTML Standard parse-error identifier. */
  readonly parseErrorId: string;
  /** Human-readable diagnostic message. */
  readonly message: string;
  /** Related parsed node when one can be identified. */
  readonly nodeId?: NodeId;
  /** Related decoded-input range when one can be identified. */
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
  /** Captures node and attribute source spans when available. */
  readonly captureSpans?: boolean;
  /** Exact decoded source retention; defaults to `"none"`. */
  readonly sourceRetention?: SourceRetention;
  /** Returned trace retention mode; defaults to `"none"`. */
  readonly trace?: TraceMode;
  /** Synchronously observes each immutable trace event without requiring retention. */
  readonly onTraceEvent?: TraceEventCallback;
  /** Inclusive resource limits for this parse. */
  readonly budgets?: ParseBudgetOptions;
  /** Cancels this parse with the signal's reason. */
  readonly signal?: AbortSignal;
}

/** Options accepted by full-document byte parsing. */
export interface ParseBytesOptions extends ParseOptions {
  /** Optional transport encoding label considered during HTML encoding sniffing. */
  readonly transportEncodingLabel?: string;
}

/** Namespace identities accepted for an HTML fragment context element. */
export type HtmlElementNamespaceUri =
  | "http://www.w3.org/1999/xhtml"
  | "http://www.w3.org/2000/svg"
  | "http://www.w3.org/1998/Math/MathML";

/** Namespace identities accepted for an HTML fragment context attribute. */
export type HtmlAttributeNamespaceUri =
  | "http://www.w3.org/1999/xlink"
  | "http://www.w3.org/XML/1998/namespace"
  | "http://www.w3.org/2000/xmlns/"
  | null;

/** Semantic attribute supplied on the external fragment context element. */
export interface HtmlFragmentContextAttribute {
  /** Attribute namespace, or null for an unnamespaced attribute. */
  readonly namespaceUri: HtmlAttributeNamespaceUri;
  /** Local attribute name; namespace prefixes are derived by the parser. */
  readonly localName: string;
  /** Attribute value visible to fragment parsing algorithms. */
  readonly value: string;
}

/** Namespace-aware external element used to establish a fragment parsing context. */
export interface HtmlFragmentContextInput {
  /** HTML, SVG, or MathML namespace of the context element. */
  readonly namespaceUri: HtmlElementNamespaceUri;
  /** Context element local name. HTML names are normalized to ASCII lowercase. */
  readonly localName: string;
  /** Attributes consulted by integration-point and tree-construction rules. */
  readonly attributes?: readonly HtmlFragmentContextAttribute[];
}

/** Normalized immutable fragment context retained on the result. */
export interface HtmlFragmentContext extends Omit<HtmlFragmentContextInput, "attributes"> {
  /** Frozen attributes with validated namespace/local-name identity. */
  readonly attributes: readonly HtmlFragmentContextAttribute[];
}

/** Owner-document mode used by fragment tree construction. */
export type HtmlDocumentMode = "no-quirks" | "limited-quirks" | "quirks";

/** Options accepted by already-decoded fragment parsing. */
export interface ParseFragmentOptions extends Omit<ParseOptions, "sourceRetention"> {
  /** Non-executing scripting environment; defaults to `"inert"`. */
  readonly scriptingMode?: HtmlScriptingMode;
  /** Context owner-document mode; defaults to `"no-quirks"`. */
  readonly documentMode?: HtmlDocumentMode;
  /** Whether an ancestor outside the supplied context descriptor is an HTML `form`. */
  readonly hasFormAncestor?: boolean;
}

/** Parse limits for byte streams, including bounded encoding-prescan retention. */
export interface ParseStreamBudgetOptions extends ParseBudgetOptions {
  /** Transport bytes retained for encoding prescan; zero disables prescan retention. */
  readonly maxEncodingPrescanBytes?: number;
}

/** Options accepted by full-document byte-stream parsing. */
export interface ParseStreamOptions extends Omit<ParseBytesOptions, "budgets"> {
  /** Parse and stream-prescan resource limits. */
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
  /** Optional transport encoding label considered during HTML encoding sniffing. */
  readonly transportEncodingLabel?: string;
  /** Resource limits for decoding and tokenization. */
  readonly budgets?: TokenizeByteStreamEagerBudgetOptions;
  /** Cancels decoding and tokenization with the signal's reason. */
  readonly signal?: AbortSignal;
}

/** Deadline and cancellation controls for one non-parse operation. */
export interface OperationOptions {
  /** Inclusive elapsed-time limit measured with the monotonic runtime clock. */
  readonly maxTimeMs?: number;
  /** Cancels the operation with an `HtmlAbortError` carrying this signal's reason. */
  readonly signal?: AbortSignal;
}

/** Non-executing scripting environment used by parsing and HTML serialization. */
export type HtmlScriptingMode = "inert" | "disabled";

/** Controls one HTML serialization operation. */
export interface SerializeOptions extends OperationOptions {
  /** Controls `noscript`; fragments inherit their parse mode, while other inputs default inert. */
  readonly scriptingMode?: HtmlScriptingMode;
}

/** Name and decoded value retained on a public start-tag token. */
export interface TokenAttribute {
  /** Attribute name as emitted by the tokenizer. */
  readonly name: string;
  /** Decoded attribute value. */
  readonly value: string;
}

/** Public start-tag token. */
export interface StartTagToken {
  /** Token discriminator. */
  readonly kind: "startTag";
  /** Emitted tag name. */
  readonly name: string;
  /** Attributes in tokenizer order after duplicate handling. */
  readonly attributes: readonly TokenAttribute[];
  /** Whether a self-closing marker was present. */
  readonly selfClosing: boolean;
}

/** Public end-tag token. */
export interface EndTagToken {
  /** Token discriminator. */
  readonly kind: "endTag";
  /** Emitted tag name. */
  readonly name: string;
}

/** Public character-data token. */
export interface CharsToken {
  /** Token discriminator. */
  readonly kind: "chars";
  /** Decoded character data. */
  readonly value: string;
}

/** Public comment token. */
export interface CommentToken {
  /** Token discriminator. */
  readonly kind: "comment";
  /** Comment data. */
  readonly value: string;
}

/** Processing-instruction token defined by the current HTML syntax. */
export interface ProcessingInstructionToken {
  /** Token discriminator. */
  readonly kind: "processingInstruction";
  /** Processing-instruction target. */
  readonly target: string;
  /** Processing-instruction data. */
  readonly data: string;
}

/** Public document-type token. */
export interface DoctypeToken {
  /** Token discriminator. */
  readonly kind: "doctype";
  /** Document-type name, or null when absent. */
  readonly name: string | null;
  /** Public identifier, or null when absent. */
  readonly publicId: string | null;
  /** System identifier, or null when absent. */
  readonly systemId: string | null;
  /** Whether this token forces quirks mode during tree construction. */
  readonly forceQuirks: boolean;
}

/** Public end-of-file token. */
export interface EofToken {
  /** Token discriminator. */
  readonly kind: "eof";
}

/** Token emitted by eager public byte-stream tokenization. */
export type Token =
  | StartTagToken
  | EndTagToken
  | CharsToken
  | CommentToken
  | ProcessingInstructionToken
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

/** Logical tokenizer output count for the parser operation that built the tree. */
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

/** Immutable text node in a parsed tree. */
export interface TextNode {
  /** Parser-assigned identity. */
  readonly id: NodeId;
  /** Node discriminator. */
  readonly kind: "text";
  /** Text data. */
  readonly value: string;
  /** Origin of captured span information; omitted when spans were not requested. */
  readonly spanProvenance?: SpanProvenance;
  /** Decoded-input range when captured and available. */
  readonly span?: Span;
}

/** Immutable comment node in a parsed tree. */
export interface CommentNode {
  /** Parser-assigned identity. */
  readonly id: NodeId;
  /** Node discriminator. */
  readonly kind: "comment";
  /** Comment data. */
  readonly value: string;
  /** Origin of captured span information; omitted when spans were not requested. */
  readonly spanProvenance?: SpanProvenance;
  /** Decoded-input range when captured and available. */
  readonly span?: Span;
}

/** Processing instruction retained as a distinct DOM node. */
export interface ProcessingInstructionNode {
  /** Parser-assigned identity. */
  readonly id: NodeId;
  /** Node discriminator. */
  readonly kind: "processingInstruction";
  /** Processing-instruction target. */
  readonly target: string;
  /** Processing-instruction data. */
  readonly data: string;
  /** Origin of captured span information; omitted when spans were not requested. */
  readonly spanProvenance?: SpanProvenance;
  /** Decoded-input range when captured and available. */
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

/** Immutable document-type node in a parsed document. */
export interface DoctypeNode {
  /** Parser-assigned identity. */
  readonly id: NodeId;
  /** Node discriminator. */
  readonly kind: "doctype";
  /** Document-type name. */
  readonly name: string;
  /** Retained public or system identifier syntax. */
  readonly externalId: DoctypeExternalId;
  /** Origin of captured span information; omitted when spans were not requested. */
  readonly spanProvenance?: SpanProvenance;
  /** Decoded-input range when captured and available. */
  readonly span?: Span;
}

/** Immutable namespace-aware element node in a parsed tree. */
export interface ElementNode {
  /** Parser-assigned identity. */
  readonly id: NodeId;
  /** Node discriminator. */
  readonly kind: "element";
  /** Namespace URI assigned by the HTML tree builder. */
  readonly namespaceUri: HtmlElementNamespaceUri;
  /** Local element name supplied by the HTML tree builder. */
  readonly localName: string;
  /** Attributes in parser order. */
  readonly attributes: readonly Attribute[];
  /** DOM child nodes; empty for an HTML template element. */
  readonly children: readonly HtmlNode[];
  /** Owned DocumentFragment, present only for an HTML template element. */
  readonly templateContent?: TemplateContentNode;
  /** Origin of captured span information; omitted when spans were not requested. */
  readonly spanProvenance?: SpanProvenance;
  /** Decoded-input range when captured and available. */
  readonly span?: Span;
}

/** The distinct DocumentFragment owned by an HTML template element. */
export interface TemplateContentNode {
  /** Parser-assigned identity distinct from the owning template element. */
  readonly id: NodeId;
  /** Node discriminator. */
  readonly kind: "templateContent";
  /** Nodes owned by the template's document fragment. */
  readonly children: readonly HtmlNode[];
  /** Inferred ownership marker when span capture was requested. */
  readonly spanProvenance?: "inferred";
}

/** Any immutable node that can occur below a public document or fragment root. */
export type HtmlNode =
  | ElementNode
  | TemplateContentNode
  | TextNode
  | CommentNode
  | ProcessingInstructionNode
  | DoctypeNode;

/** Callback invoked for a node and its zero-based traversal depth. */
export type NodeVisitor = (node: HtmlNode, depth: number) => void;
/** Callback invoked for an element and its zero-based traversal depth. */
export type ElementVisitor = (node: ElementNode, depth: number) => void;

/** Immutable root returned by full-document parsing. */
export interface DocumentTree {
  /** Parser-assigned root identity. */
  readonly id: NodeId;
  /** Root discriminator. */
  readonly kind: "document";
  /** Top-level document nodes in tree order. */
  readonly children: readonly HtmlNode[];
  /** Non-fatal parse errors in emission order. */
  readonly errors: readonly ParseError[];
  /** Retained trace when tracing was requested. */
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

/** Immutable root returned by fragment parsing. */
export interface FragmentTree {
  /** Parser-assigned root identity. */
  readonly id: NodeId;
  /** Root discriminator. */
  readonly kind: "fragment";
  /** Normalized namespace-aware external context element. */
  readonly context: HtmlFragmentContext;
  /** Effective non-executing scripting environment used for this parse. */
  readonly scriptingMode: HtmlScriptingMode;
  /** Effective context owner-document mode used for this parse. */
  readonly documentMode: HtmlDocumentMode;
  /** Whether the context chain seeded the form element pointer. */
  readonly hasFormInContextChain: boolean;
  /** Top-level fragment nodes in tree order. */
  readonly children: readonly HtmlNode[];
  /** Non-fatal parse errors in emission order. */
  readonly errors: readonly ParseError[];
  /** Retained trace when tracing was requested. */
  readonly trace?: TraceResult;
}

/** One structural outline entry derived from a heading or sectioning element. */
export interface OutlineEntry {
  /** Identity of the source element. */
  readonly nodeId: NodeId;
  /** Zero-based traversal depth of the source element. */
  readonly depth: number;
  /** Local source element name. */
  readonly localName: string;
  /** Bounded text extracted from the source element. */
  readonly text: string;
}

/** Structural outline in document order. */
export interface Outline {
  /** Immutable outline entries. */
  readonly entries: readonly OutlineEntry[];
}

/** Serialized group of complete top-level nodes. */
export interface Chunk {
  /** Zero-based output chunk index. */
  readonly index: number;
  /** Identity of the first node in the chunk. */
  readonly nodeId: NodeId;
  /** Serialized HTML for all nodes in the chunk. */
  readonly content: string;
  /** Total nodes represented by the chunk. */
  readonly nodes: number;
}

/** Character, node, and byte targets for top-level serialization chunks. */
export interface ChunkOptions extends OperationOptions {
  /** Preferred maximum UTF-16 code units per chunk. */
  readonly maxChars?: number;
  /** Preferred maximum represented nodes per chunk. */
  readonly maxNodes?: number;
  /** Preferred maximum UTF-8 bytes per chunk. */
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

/** Removes one parsed node. */
export interface RemoveNodeEdit {
  /** Edit discriminator. */
  readonly kind: "removeNode";
  /** Identity of the node to remove. */
  readonly target: NodeId;
}

/** Replaces the data of one parsed text node. */
export interface ReplaceTextEdit {
  /** Edit discriminator. */
  readonly kind: "replaceText";
  /** Identity of the text node to replace. */
  readonly target: NodeId;
  /** Replacement text data. */
  readonly value: string;
}

/** Sets an unnamespaced attribute on one parsed element. */
export interface SetAttrEdit {
  /** Edit discriminator. */
  readonly kind: "setAttr";
  /** Identity of the element to edit. */
  readonly target: NodeId;
  /** HTML attribute name. */
  readonly name: string;
  /** Replacement attribute value. */
  readonly value: string;
}

/** Removes an unnamespaced attribute from one parsed element. */
export interface RemoveAttrEdit {
  /** Edit discriminator. */
  readonly kind: "removeAttr";
  /** Identity of the element to edit. */
  readonly target: NodeId;
  /** HTML attribute name. */
  readonly name: string;
}

/** Inserts serialized HTML immediately before one parsed node. */
export interface InsertHtmlBeforeEdit {
  /** Edit discriminator. */
  readonly kind: "insertHtmlBefore";
  /** Identity of the reference node. */
  readonly target: NodeId;
  /** HTML source to insert. */
  readonly html: string;
}

/** Inserts serialized HTML immediately after one parsed node. */
export interface InsertHtmlAfterEdit {
  /** Edit discriminator. */
  readonly kind: "insertHtmlAfter";
  /** Identity of the reference node. */
  readonly target: NodeId;
  /** HTML source to insert. */
  readonly html: string;
}

/** Source edit accepted by the patch planner. */
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
  | "INVALID_EDIT"
  | "INVALID_EDIT_TARGET"
  | "CONFLICTING_EDITS"
  | "UNREPRESENTABLE_TEXT_VALUE"
  | "ATTRIBUTE_NOT_FOUND"
  | "ATTRIBUTE_NAME_COLLISION"
  | "ATTRIBUTE_SPAN_MISSING"
  | "ELEMENT_START_TAG_NOT_FOUND"
  | "OVERLAPPING_EDITS"
  | "INVALID_PLAN_SLICE"
  | "INVALID_PLAN_INSERTION";

/** Copies a half-open range from the retained original source. */
export interface PatchSliceStep {
  /** Patch-step discriminator. */
  readonly kind: "slice";
  /** Inclusive UTF-16 source offset. */
  readonly start: number;
  /** Exclusive UTF-16 source offset. */
  readonly end: number;
}

/** Inserts source text at one UTF-16 source offset. */
export interface PatchInsertStep {
  /** Patch-step discriminator. */
  readonly kind: "insert";
  /** UTF-16 source offset where text is inserted. */
  readonly at: number;
  /** Source text to insert. */
  readonly text: string;
}

/** Ordered source operation in a patch plan. */
export type PatchStep = PatchSliceStep | PatchInsertStep;

/** Immutable patch operations and their precomputed result. */
export interface PatchPlan {
  /** Ordered, non-overlapping source operations. */
  readonly steps: readonly PatchStep[];
  /** HTML produced by applying the steps. */
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
