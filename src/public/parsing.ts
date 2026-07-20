import { decodeHtmlBytes } from "../internal/encoding/mod.ts";
import {
  failInternalState,
  requireInternalValue
} from "../internal/foundation/internal-state-error.ts";
import {
  HTML_NAMESPACE,
  EngineAbortError,
  EngineResourceLimitError,
  HtmlTokenizer,
  createEngineResourceGuard,
  runHtmlEngine
} from "../internal/html-engine/mod.ts";

import { enforceBudget } from "./budgets.ts";
import { HtmlAbortError, HtmlBudgetExceededError, HtmlConfigurationError } from "./errors.ts";
import {
  DecodedUtf8BudgetCounter,
  decodeStreamToText,
  requireByteArray,
  requireReadableByteStream,
  requireString,
  utf8ByteLength
} from "./html-input.ts";
import {
  createOperationContext,
  normalizeParseBytesOptions,
  normalizeParseFragmentOptions,
  normalizeParseOptions,
  normalizeParseStreamOptions,
  normalizeTokenizeByteStreamEagerOptions
} from "./operation.ts";
import { normalizeParseErrorId, TraceSink } from "./parse-trace.ts";
import { registerParsedDocument } from "./parsed-document-registry.ts";

import type { OperationContext } from "./operation.ts";
import type {
  Attribute,
  DocumentTree,
  FragmentTree,
  HtmlBudgetName,
  HtmlNode,
  NodeId,
  ParseBytesOptions,
  ParseFragmentOptions,
  ParseOptions,
  ParsedDocument,
  ParsedDocumentMetadata,
  ParseResourceUsage,
  ParseStreamOptions,
  Span,
  SpanProvenance,
  TemplateContentNode,
  Token,
  TokenizeByteStreamEagerOptions
} from "./types.ts";
import type {
  EngineParseError,
  EngineResourceLimitName,
  EngineResourceLimits,
  HtmlTemplateContents,
  HtmlToken,
  HtmlTreeDoctypeExternalId,
  HtmlTreeElement,
  HtmlTreeModel,
  HtmlTreeNode,
  HtmlTreeParent,
  HtmlTreeRoot,
  SourceSpan
} from "../internal/html-engine/mod.ts";

interface ParseInputContext {
  readonly inputKind: ParsedDocumentMetadata["inputKind"];
  readonly byteLength: number;
  readonly decodedUtf8ByteLength: number;
  readonly transportByteLength: number | null;
  readonly metadataEncoding: ParsedDocumentMetadata["encoding"];
  readonly encodingPrescanBytes: number;
  readonly operation: OperationContext;
  readonly startedAt: number;
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

const WHATWG_PARSE_ERRORS_SECTION_URL =
  "https://html.spec.whatwg.org/multipage/parsing.html#parse-errors";

/** Returns the HTML Standard parse-errors section for a parser diagnostic. */
export function getParseErrorSpecRef(parseErrorId: string): string {
  void parseErrorId;
  return WHATWG_PARSE_ERRORS_SECTION_URL;
}

class NodeIdAssigner {
  #next: NodeId = 1;

  get assigned(): number {
    return this.#next - 1;
  }

  next(): NodeId {
    const id = this.#next;
    this.#next += 1;
    return id;
  }
}

function publicBudgetName(resource: EngineResourceLimitName): HtmlBudgetName {
  if (resource === "maxAttributeUtf8BytesPerElement") return "maxAttributeBytes";
  if (resource === "maxSteps") {
    return failInternalState("PRODUCT_ADAPTER_UNMAPPED_RESOURCE_LIMIT");
  }
  return resource;
}

function engineLimits(options: ParseOptions["budgets"]): EngineResourceLimits {
  if (options === undefined) return Object.freeze({});
  return Object.freeze({
    ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.maxParseErrors === undefined ? {} : { maxParseErrors: options.maxParseErrors }),
    ...(options.maxAttributesPerElement === undefined
      ? {}
      : { maxAttributesPerElement: options.maxAttributesPerElement }),
    ...(options.maxAttributeBytes === undefined
      ? {}
      : { maxAttributeUtf8BytesPerElement: options.maxAttributeBytes }),
    ...(options.maxTimeMs === undefined ? {} : { maxTimeMs: options.maxTimeMs })
  });
}

function mapEngineFailure(error: unknown): never {
  if (error instanceof EngineResourceLimitError) {
    throw new HtmlBudgetExceededError(
      publicBudgetName(error.resource),
      error.limit,
      error.actual
    );
  }
  if (error instanceof EngineAbortError) throw new HtmlAbortError(error.cause);
  throw error;
}

function publicSpan(span: SourceSpan | null, captureSpans: boolean): Span | undefined {
  if (!captureSpans || span === null) return undefined;
  return Object.freeze({ start: span.startUtf16Offset, end: span.endUtf16Offset });
}

function spanProvenance(span: SourceSpan | null, captureSpans: boolean): SpanProvenance {
  if (!captureSpans) return "none";
  return span === null ? "inferred" : "input";
}

function children(
  parent: HtmlTreeParent,
  model: HtmlTreeModel,
  operation: OperationContext
): readonly HtmlTreeNode[] {
  const result: HtmlTreeNode[] = [];
  for (const child of model.childrenOf(parent)) {
    operation.checkpoint();
    result.push(child);
  }
  return result;
}

function attributes(
  element: HtmlTreeElement,
  model: HtmlTreeModel,
  captureSpans: boolean,
  operation: OperationContext
): readonly Attribute[] {
  const result: Attribute[] = [];
  for (const attribute of model.attributesOf(element)) {
    operation.checkpoint();
    const span = publicSpan(attribute.sourceSpan, captureSpans);
    result.push(Object.freeze({
      namespaceUri: attribute.namespaceUri,
      prefix: attribute.prefix,
      localName: attribute.localName,
      name: attribute.qualifiedName,
      value: attribute.value,
      ...(span === undefined ? {} : { span })
    }));
  }
  return Object.freeze(result);
}

function externalId(value: HtmlTreeDoctypeExternalId) {
  switch (value.kind) {
    case "none": return Object.freeze({ kind: "none" as const });
    case "public": {
      return Object.freeze({
        kind: "public" as const,
        publicId: value.publicIdentifier,
        systemId: value.systemIdentifier
      });
    }
    case "system": {
      return Object.freeze({ kind: "system" as const, systemId: value.systemIdentifier });
    }
  }
}

type ConversionSource = HtmlTreeNode | HtmlTemplateContents;
const EMPTY_HTML_NODES: readonly HtmlNode[] = Object.freeze([]);

function pushConversionChildren(
  source: ConversionSource,
  model: HtmlTreeModel,
  sources: ConversionSource[],
  expanded: boolean[],
  operation: OperationContext
): void {
  if (source.kind === "element" && source.templateContents !== null) {
    sources.push(source.templateContents);
    expanded.push(false);
    return;
  }
  if (source.kind !== "element" && source.kind !== "template-contents") return;
  const sourceChildren = model.childrenOf(source);
  for (let index = sourceChildren.length - 1; index >= 0; index -= 1) {
    operation.checkpoint();
    const child = sourceChildren[index];
    if (child !== undefined) {
      sources.push(child);
      expanded.push(false);
    }
  }
}

function convertedChildren(
  parent: HtmlTreeParent,
  model: HtmlTreeModel,
  converted: readonly (HtmlNode | undefined)[],
  operation: OperationContext
): readonly HtmlNode[] {
  const result: HtmlNode[] = [];
  for (const child of model.childrenOf(parent)) {
    operation.checkpoint();
    result.push(requireInternalValue(
      converted[child.identity.serial],
      "PRODUCT_ADAPTER_CHILD_CONVERSION_MISSING"
    ));
  }
  return Object.freeze(result);
}

function createPublicNode(
  source: ConversionSource,
  model: HtmlTreeModel,
  assigner: NodeIdAssigner,
  captureSpans: boolean,
  directChildren: readonly HtmlNode[],
  templateContent: HtmlNode | undefined,
  operation: OperationContext
): HtmlNode {
  if (source.kind === "template-contents") {
    return Object.freeze({
      id: assigner.next(),
      kind: "templateContent",
      children: directChildren,
      spanProvenance: "inferred"
    } satisfies TemplateContentNode);
  }
  const span = publicSpan(source.sourceSpan, captureSpans);
  const provenance = spanProvenance(source.sourceSpan, captureSpans);
  if (source.kind === "text") {
    return Object.freeze({
      id: assigner.next(), kind: "text", value: source.data, spanProvenance: provenance,
      ...(span === undefined ? {} : { span })
    });
  }
  if (source.kind === "comment") {
    return Object.freeze({
      id: assigner.next(), kind: "comment", value: source.data, spanProvenance: provenance,
      ...(span === undefined ? {} : { span })
    });
  }
  if (source.kind === "processing-instruction") {
    return Object.freeze({
      id: assigner.next(), kind: "processingInstruction",
      target: source.target, data: source.data, spanProvenance: provenance,
      ...(span === undefined ? {} : { span })
    });
  }
  if (source.kind === "doctype") {
    return Object.freeze({
      id: assigner.next(), kind: "doctype", name: source.name,
      externalId: externalId(source.externalId), spanProvenance: provenance,
      ...(span === undefined ? {} : { span })
    });
  }
  if (templateContent !== undefined && templateContent.kind !== "templateContent") {
    failInternalState("PRODUCT_ADAPTER_TEMPLATE_CONTENT_KIND_MISMATCH");
  }
  return Object.freeze({
    id: assigner.next(), kind: "element",
    namespaceUri: source.namespaceUri, prefix: source.prefix,
    localName: source.localName, tagName: source.qualifiedName,
    attributes: attributes(source, model, captureSpans, operation), children: directChildren,
    ...(templateContent === undefined ? {} : { templateContent }),
    spanProvenance: provenance,
    ...(span === undefined ? {} : { span })
  });
}

function convertReadySource(
  source: ConversionSource,
  model: HtmlTreeModel,
  converted: readonly (HtmlNode | undefined)[],
  assigner: NodeIdAssigner,
  captureSpans: boolean,
  operation: OperationContext
): HtmlNode {
  const directChildren = source.kind === "template-contents" ||
      (source.kind === "element" && source.templateContents === null)
    ? convertedChildren(source, model, converted, operation)
    : EMPTY_HTML_NODES;
  const templateContent = source.kind === "element" && source.templateContents !== null
    ? converted[source.templateContents.identity.serial]
    : undefined;
  return createPublicNode(
    source,
    model,
    assigner,
    captureSpans,
    directChildren,
    templateContent,
    operation
  );
}

function convertRecursively(
  source: ConversionSource,
  model: HtmlTreeModel,
  assigner: NodeIdAssigner,
  captureSpans: boolean,
  operation: OperationContext
): HtmlNode {
  operation.checkpoint();
  let directChildren = EMPTY_HTML_NODES;
  let templateContent: HtmlNode | undefined;
  if (source.kind === "element" && source.templateContents !== null) {
    templateContent = convertRecursively(
      source.templateContents,
      model,
      assigner,
      captureSpans,
      operation
    );
  } else if (source.kind === "element" || source.kind === "template-contents") {
    const convertedChildren: HtmlNode[] = [];
    for (const child of model.childrenOf(source)) {
      convertedChildren.push(
        convertRecursively(child, model, assigner, captureSpans, operation)
      );
    }
    directChildren = Object.freeze(convertedChildren);
  }
  return createPublicNode(
    source,
    model,
    assigner,
    captureSpans,
    directChildren,
    templateContent,
    operation
  );
}

function convertNodes(
  root: HtmlTreeRoot,
  model: HtmlTreeModel,
  assigner: NodeIdAssigner,
  captureSpans: boolean,
  maxDepth: number,
  operation: OperationContext
): readonly HtmlNode[] {
  const converted: Array<HtmlNode | undefined> = [];
  const roots = children(root, model, operation);
  if (maxDepth <= 128) {
    return Object.freeze(roots.map((source) =>
      convertRecursively(source, model, assigner, captureSpans, operation)
    ));
  } else {
    const sources: ConversionSource[] = [];
    const expanded: boolean[] = [];
    for (let index = roots.length - 1; index >= 0; index -= 1) {
      const source = roots[index];
      if (source !== undefined) {
        sources.push(source);
        expanded.push(false);
      }
    }
    while (sources.length > 0) {
      operation.checkpoint();
      const source = sources.pop();
      const isExpanded = expanded.pop();
      if (source === undefined || isExpanded === undefined) break;
      if (!isExpanded) {
        sources.push(source);
        expanded.push(true);
        pushConversionChildren(source, model, sources, expanded, operation);
      } else {
        converted[source.identity.serial] = convertReadySource(
          source,
          model,
          converted,
          assigner,
          captureSpans,
          operation
        );
      }
    }
  }

  return Object.freeze(roots.map((source) => {
    operation.checkpoint();
    return requireInternalValue(
      converted[source.identity.serial],
      "PRODUCT_ADAPTER_ROOT_CONVERSION_MISSING"
    );
  }));
}

function diagnosticMessage(error: EngineParseError): string {
  if (error.phase !== "tree-builder") return error.code;
  return `${error.code}: insertionMode=${error.insertionMode} tokenKind=${error.tokenKind}` +
    (error.tagName === null ? "" : ` tagName=${error.tagName}`);
}

function parseError(error: EngineParseError) {
  const span = Object.freeze({
    start: error.span.startUtf16Offset,
    end: error.span.endUtf16Offset
  });
  return Object.freeze({
    code: "PARSER_ERROR" as const,
    parseErrorId: normalizeParseErrorId(error.code),
    message: diagnosticMessage(error),
    span
  });
}

function parseErrors(
  errors: readonly EngineParseError[],
  operation: OperationContext
) {
  return Object.freeze(errors.map((error) => {
    operation.checkpoint();
    return parseError(error);
  }));
}

function stringInputContext(
  html: string,
  operation: OperationContext,
  startedAt: number
): ParseInputContext {
  const byteLength = utf8ByteLength(html, operation);
  return {
    inputKind: "text",
    byteLength,
    decodedUtf8ByteLength: byteLength,
    transportByteLength: null,
    metadataEncoding: { name: null, source: "already-decoded" },
    encodingPrescanBytes: 0,
    operation,
    startedAt,
    decode: { source: "input", encoding: "utf-8", sniffSource: "input" }
  };
}

function parseDocumentOperation(
  html: string,
  options: ParseOptions | ParseBytesOptions | ParseStreamOptions,
  input: ParseInputContext
): ParsedDocument {
  const operation = input.operation;
  const budgets = options.budgets;
  const captureSpans = options.captureSpans ?? false;
  const trace = new TraceSink(options.trace ?? "none", options.onTraceEvent, budgets, operation);
  enforceBudget("maxInputBytes", budgets?.maxInputBytes, input.byteLength);
  enforceBudget("maxDecodedUtf8Bytes", budgets?.maxDecodedUtf8Bytes, input.decodedUtf8ByteLength);
  trace.emit({ kind: "decode", ...input.decode });
  if (input.stream !== undefined) trace.emit({ kind: "stream", ...input.stream });
  trace.emitBudget("maxInputBytes", budgets?.maxInputBytes, input.byteLength);

  let tokenCount = 0;
  let previousCharacter = false;
  let result;
  try {
    result = runHtmlEngine({
      inputChunks: [html],
      retainNodeSpans: captureSpans,
      parser: { kind: "document", scriptingMode: "inert" },
      limits: engineLimits(budgets),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      startedAt: input.startedAt,
      ...(trace.active
        ? {
            observer: {
              onToken(token): void {
                if (token.kind !== "character" || !previousCharacter) tokenCount += 1;
                previousCharacter = token.kind === "character";
              },
              onParseError(error): void {
                trace.emit({
                  kind: "parseError",
                  parseErrorId: normalizeParseErrorId(error.code),
                  startOffset: error.span.startUtf16Offset,
                  endOffset: error.span.endUtf16Offset
                });
              },
              onInsertionModeTransition(transition): void {
                trace.emit({
                  kind: "insertionModeTransition",
                  fromMode: transition.from,
                  toMode: transition.to,
                  tokenContext: {
                    type: transition.token.kind,
                    tagName: transition.token.tagName,
                    startOffset: transition.token.span.startUtf16Offset,
                    endOffset: transition.token.span.endUtf16Offset
                  }
                });
              }
            }
          }
        : {})
    });
  } catch (error) {
    return mapEngineFailure(error);
  }

  trace.emit({ kind: "token", count: tokenCount });
  const assigner = new NodeIdAssigner();
  const documentId = assigner.next();
  const publicChildren = convertNodes(
    result.model.root,
    result.model,
    assigner,
    captureSpans,
    result.resources.maxDepth,
    operation
  );
  const attachedNodes = assigner.assigned;
  const errors = parseErrors(result.parseErrors, operation);
  trace.emit({
    kind: "tree-mutation",
    nodeCount: attachedNodes,
    errorCount: errors.length
  });
  trace.emitBudget("maxNodes", budgets?.maxNodes, result.resources.nodes);
  trace.emitBudget("maxDepth", budgets?.maxDepth, result.resources.maxDepth);
  const traceResult = trace.finish({
    tokenCount,
    nodeCount: attachedNodes,
    maxDepth: result.resources.maxDepth,
    parseErrorCount: errors.length,
    encoding: { name: input.decode.encoding, source: input.decode.sniffSource },
    inputBytes: input.byteLength,
    decodedUtf8Bytes: input.decodedUtf8ByteLength,
    bytesRead: input.stream?.bytesRead ?? null,
    encodingPrescanBytes: input.stream?.encodingPrescanBytes ?? null,
    encodingPrescanLimitBytes: input.stream?.encodingPrescanLimitBytes ?? null
  });
  const tree: DocumentTree = Object.freeze({
    id: documentId,
    kind: "document",
    children: publicChildren,
    errors,
    ...(traceResult === undefined ? {} : { trace: traceResult })
  });
  const resourceUsage: ParseResourceUsage = Object.freeze({
    inputBytes: input.byteLength,
    decodedUtf8Bytes: input.decodedUtf8ByteLength,
    decodedCodeUnits: html.length,
    nodes: result.resources.nodes,
    maxDepth: result.resources.maxDepth,
    parseErrors: result.resources.parseErrors,
    attributes: result.resources.attributes,
    attributeUtf8Bytes: result.resources.attributeUtf8Bytes,
    encodingPrescanBytes: input.encodingPrescanBytes,
    traceEvents: trace.eventCount,
    traceUtf8Bytes: trace.eventUtf8Bytes
  });
  const parsed: ParsedDocument = Object.freeze({
    tree,
    sourceText: options.sourceRetention === "text" ? html : null,
    metadata: Object.freeze({
      inputKind: input.inputKind,
      transportByteLength: input.transportByteLength,
      encoding: Object.freeze({ ...input.metadataEncoding }),
      resourceUsage
    })
  });
  registerParsedDocument(parsed, parsed.sourceText, captureSpans);
  return parsed;
}

/**
 * Parses a JavaScript string as a complete HTML document.
 *
 * @example
 * ```ts
 * import { parse } from "jsr:@ismail-elkorchi/html-parser";
 *
 * const document = parse("<main>Hello</main>");
 * console.log(document.tree.kind);
 * ```
 */
export function parse(html: string, options: ParseOptions = {}): ParsedDocument {
  const startedAt = performance.now();
  const normalized = normalizeParseOptions(options);
  requireString(html, "input");
  const operation = createOperationContext(normalized.budgets?.maxTimeMs, normalized.signal, startedAt);
  operation.checkpoint();
  return parseDocumentOperation(html, normalized, stringInputContext(html, operation, startedAt));
}

/** Decodes and parses HTML bytes into a bounded immutable document result. */
export function parseBytes(
  bytes: Uint8Array,
  options: ParseBytesOptions = {}
): ParsedDocument {
  const startedAt = performance.now();
  const normalized = normalizeParseBytesOptions(options);
  requireByteArray(bytes, "input");
  const operation = createOperationContext(normalized.budgets?.maxTimeMs, normalized.signal, startedAt);
  operation.checkpoint();
  enforceBudget("maxInputBytes", normalized.budgets?.maxInputBytes, bytes.byteLength);
  const decodedBudget = new DecodedUtf8BudgetCounter(
    normalized.budgets?.maxDecodedUtf8Bytes,
    operation
  );
  const decoded = decodeHtmlBytes(bytes, {
    ...(normalized.transportEncodingLabel === undefined
      ? {}
      : { transportEncodingLabel: normalized.transportEncodingLabel }),
    onDecodedChunk(chunk): void { decodedBudget.append(chunk); }
  });
  return parseDocumentOperation(decoded.text, normalized, {
    inputKind: "bytes",
    byteLength: bytes.byteLength,
    decodedUtf8ByteLength: decodedBudget.bytes,
    transportByteLength: bytes.byteLength,
    metadataEncoding: { name: decoded.sniff.encoding, source: decoded.sniff.source },
    encodingPrescanBytes: 0,
    operation,
    startedAt,
    decode: { source: "sniff", encoding: decoded.sniff.encoding, sniffSource: decoded.sniff.source }
  });
}

/**
 * Parses an HTML fragment using the supplied context element name.
 *
 * @example
 * ```ts
 * import { parseFragment } from "jsr:@ismail-elkorchi/html-parser";
 *
 * const fragment = parseFragment("<td>Cell", "tr");
 * console.log(fragment.children.length);
 * ```
 */
export function parseFragment(
  html: string,
  contextTagName: string,
  options: ParseFragmentOptions = {}
): FragmentTree {
  const startedAt = performance.now();
  const normalized = normalizeParseFragmentOptions(options);
  requireString(html, "input");
  requireString(contextTagName, "contextTagName");
  const context = contextTagName.trim().toLowerCase();
  if (context.length === 0) {
    throw new HtmlConfigurationError("contextTagName", "INVALID_VALUE", "must be a non-empty tag name");
  }
  const operation = createOperationContext(normalized.budgets?.maxTimeMs, normalized.signal, startedAt);
  const inputBytes = utf8ByteLength(html, operation);
  enforceBudget("maxInputBytes", normalized.budgets?.maxInputBytes, inputBytes);
  enforceBudget("maxDecodedUtf8Bytes", normalized.budgets?.maxDecodedUtf8Bytes, inputBytes);
  const trace = new TraceSink(
    normalized.trace ?? "none",
    normalized.onTraceEvent,
    normalized.budgets,
    operation
  );
  trace.emit({ kind: "decode", source: "input", encoding: "utf-8", sniffSource: "input" });
  trace.emitBudget("maxInputBytes", normalized.budgets?.maxInputBytes, inputBytes);
  let tokenCount = 0;
  let previousCharacter = false;
  let result;
  try {
    result = runHtmlEngine({
      inputChunks: [html],
      retainNodeSpans: normalized.captureSpans ?? false,
      parser: {
        kind: "fragment",
        scriptingMode: "inert",
        context: { namespaceUri: HTML_NAMESPACE, localName: context, attributes: Object.freeze([]) }
      },
      limits: engineLimits(normalized.budgets),
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
      startedAt,
      ...(trace.active
        ? {
            observer: {
              onToken(token): void {
                if (token.kind !== "character" || !previousCharacter) tokenCount += 1;
                previousCharacter = token.kind === "character";
              },
              onParseError(error): void {
                trace.emit({
                  kind: "parseError",
                  parseErrorId: normalizeParseErrorId(error.code),
                  startOffset: error.span.startUtf16Offset,
                  endOffset: error.span.endUtf16Offset
                });
              },
              onInsertionModeTransition(transition): void {
                trace.emit({
                  kind: "insertionModeTransition",
                  fromMode: transition.from,
                  toMode: transition.to,
                  tokenContext: {
                    type: transition.token.kind,
                    tagName: transition.token.tagName,
                    startOffset: transition.token.span.startUtf16Offset,
                    endOffset: transition.token.span.endUtf16Offset
                  }
                });
              }
            }
          }
        : {})
    });
  } catch (error) {
    return mapEngineFailure(error);
  }
  trace.emit({ kind: "token", count: tokenCount });
  const assigner = new NodeIdAssigner();
  const fragmentId = assigner.next();
  const publicChildren = convertNodes(
    result.model.root,
    result.model,
    assigner,
    normalized.captureSpans ?? false,
    result.resources.maxDepth,
    operation
  );
  const attachedNodes = assigner.assigned;
  const errors = parseErrors(result.parseErrors, operation);
  trace.emit({ kind: "tree-mutation", nodeCount: attachedNodes, errorCount: errors.length });
  trace.emitBudget("maxNodes", normalized.budgets?.maxNodes, result.resources.nodes);
  trace.emitBudget("maxDepth", normalized.budgets?.maxDepth, result.resources.maxDepth);
  const traceResult = trace.finish({
    tokenCount,
    nodeCount: attachedNodes,
    maxDepth: result.resources.maxDepth,
    parseErrorCount: errors.length,
    encoding: { name: "utf-8", source: "input" },
    inputBytes,
    decodedUtf8Bytes: inputBytes,
    bytesRead: null,
    encodingPrescanBytes: null,
    encodingPrescanLimitBytes: null
  });
  return Object.freeze({
    id: fragmentId,
    kind: "fragment",
    contextTagName: context,
    children: publicChildren,
    errors,
    ...(traceResult === undefined ? {} : { trace: traceResult })
  });
}

function publicToken(token: HtmlToken, operation: OperationContext): Token {
  switch (token.kind) {
    case "start-tag": {
      const publicAttributes = token.attributes.map((attribute) => {
        operation.checkpoint();
        return Object.freeze({ name: attribute.name, value: attribute.value });
      });
      return Object.freeze({
        kind: "startTag",
        name: token.name,
        attributes: Object.freeze(publicAttributes),
        selfClosing: token.selfClosing
      });
    }
    case "end-tag": return Object.freeze({ kind: "endTag", name: token.name });
    case "character": return Object.freeze({ kind: "chars", value: token.data });
    case "comment": return Object.freeze({ kind: "comment", value: token.data });
    case "processing-instruction": {
      return Object.freeze({ kind: "processingInstruction", target: token.target, data: token.data });
    }
    case "doctype": {
      return Object.freeze({
        kind: "doctype",
        name: token.name,
        publicId: token.publicIdentifier,
        systemId: token.systemIdentifier,
        forceQuirks: token.forceQuirks
      });
    }
    case "eof": return Object.freeze({ kind: "eof" });
  }
}

/** Eagerly decodes and tokenizes a byte stream after complete input. */
export async function tokenizeByteStreamEager(
  stream: ReadableStream<Uint8Array>,
  options: TokenizeByteStreamEagerOptions = {}
): Promise<readonly Token[]> {
  const startedAt = performance.now();
  const normalized = normalizeTokenizeByteStreamEagerOptions(options);
  requireReadableByteStream(stream, "input");
  const operation = createOperationContext(normalized.budgets?.maxTimeMs, normalized.signal, startedAt);
  const decoded = await decodeStreamToText(stream, normalized, operation);
  const limits: EngineResourceLimits = Object.freeze({
    ...(normalized.budgets?.maxParseErrors === undefined
      ? {}
      : { maxParseErrors: normalized.budgets.maxParseErrors }),
    ...(normalized.budgets?.maxAttributesPerElement === undefined
      ? {}
      : { maxAttributesPerElement: normalized.budgets.maxAttributesPerElement }),
    ...(normalized.budgets?.maxAttributeBytes === undefined
      ? {}
      : { maxAttributeUtf8BytesPerElement: normalized.budgets.maxAttributeBytes }),
    ...(normalized.budgets?.maxTimeMs === undefined
      ? {}
      : { maxTimeMs: normalized.budgets.maxTimeMs })
  });
  const resources = createEngineResourceGuard({
    limits,
    ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    startedAt
  });
  const tokens: Token[] = [];
  const tokenizer = new HtmlTokenizer(resources, {
    accept(token) {
      operation.checkpoint();
      tokens.push(publicToken(token, operation));
      return token.kind !== "start-tag" || token.selfClosing;
    }
  });
  try {
    tokenizer.write(decoded.text);
    tokenizer.close();
  } catch (error) {
    return mapEngineFailure(error);
  }
  operation.checkpoint();
  return Object.freeze(tokens);
}

/**
 * Reads and decodes a byte stream through EOF, releases its reader, and then
 * parses the buffered document deterministically.
 *
 * @example
 * ```ts
 * import { parseStream } from "jsr:@ismail-elkorchi/html-parser";
 *
 * const bytes = new TextEncoder().encode("<p>Hello</p>");
 * const document = await parseStream(new Blob([bytes]).stream());
 * console.log(document.metadata.inputKind);
 * ```
 */
export async function parseStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseStreamOptions = {}
): Promise<ParsedDocument> {
  const startedAt = performance.now();
  const normalized = normalizeParseStreamOptions(options);
  requireReadableByteStream(stream, "input");
  const operation = createOperationContext(normalized.budgets?.maxTimeMs, normalized.signal, startedAt);
  const decoded = await decodeStreamToText(stream, normalized, operation);
  return parseDocumentOperation(decoded.text, normalized, {
    inputKind: "stream",
    byteLength: decoded.totalBytes,
    decodedUtf8ByteLength: decoded.decodedUtf8Bytes,
    transportByteLength: decoded.totalBytes,
    metadataEncoding: { name: decoded.sniff.encoding, source: decoded.sniff.source },
    encodingPrescanBytes: decoded.encodingPrescanBytes,
    operation,
    startedAt,
    decode: { source: "sniff", encoding: decoded.sniff.encoding, sniffSource: decoded.sniff.source },
    stream: {
      bytesRead: decoded.totalBytes,
      encodingPrescanBytes: decoded.encodingPrescanBytes,
      encodingPrescanLimitBytes: decoded.encodingPrescanLimitBytes
    }
  });
}
