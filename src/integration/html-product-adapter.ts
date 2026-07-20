import { decodeHtmlBytes } from "../internal/encoding/mod.js";
import {
  failInternalState,
  requireInternalValue
} from "../internal/foundation/internal-state-error.js";
import {
  HTML_NAMESPACE,
  EngineAbortError,
  EngineResourceLimitError,
  HtmlTokenizer,
  createEngineResourceGuard,
  runHtmlEngine
} from "../internal/html-engine/mod.js";
import { enforceBudget } from "../public/budgets.js";
import { HtmlAbortError, HtmlBudgetExceededError, HtmlConfigurationError } from "../public/errors.js";
import {
  DecodedUtf8BudgetCounter,
  decodeStreamToText,
  requireByteArray,
  requireReadableByteStream,
  requireString,
  utf8ByteLength
} from "../public/html-input.js";
import { createTextOperations } from "../public/mod.js";
import {
  createOperationContext,
  normalizeParseBytesOptions,
  normalizeParseFragmentOptions,
  normalizeParseOptions,
  normalizeParseStreamOptions,
  normalizeTokenizeByteStreamEagerOptions
} from "../public/operation.js";
import { normalizeParseErrorId, TraceSink } from "../public/parse-trace.js";
import { registerParsedDocument } from "../public/parsed-document-registry.js";

import type {
  EngineParseError,
  EngineResourceLimitName,
  EngineResourceLimits,
  HtmlTemplateContents,
  HtmlToken,
  HtmlTreeDoctypeExternalId,
  HtmlTreeElement,
  HtmlTreeNode,
  HtmlTreeParent,
  HtmlTreeRoot,
  SourceSpan
} from "../internal/html-engine/mod.js";
import type { OperationContext } from "../public/operation.js";
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
} from "../public/types.js";

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

class NodeIdAssigner {
  #next: NodeId = 1;

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
  operation: OperationContext
): readonly HtmlTreeNode[] {
  const result: HtmlTreeNode[] = [];
  for (let index = 0; index < parent.childCount; index += 1) {
    operation.checkpoint();
    const child = parent.childAt(index);
    if (child !== null) result.push(child);
  }
  return result;
}

function attributes(
  element: HtmlTreeElement,
  captureSpans: boolean,
  operation: OperationContext
): readonly Attribute[] {
  const result: Attribute[] = [];
  for (let index = 0; index < element.attributeCount; index += 1) {
    operation.checkpoint();
    const attribute = element.attributeAt(index);
    if (attribute === null) continue;
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

function sourceChildren(
  source: ConversionSource,
  operation: OperationContext
): readonly ConversionSource[] {
  if (source.kind === "template-contents") return children(source, operation);
  if (source.kind !== "element") return [];
  return source.templateContents === null
    ? children(source, operation)
    : [source.templateContents];
}

function convertNodes(
  root: HtmlTreeRoot,
  assigner: NodeIdAssigner,
  captureSpans: boolean,
  operation: OperationContext
): readonly HtmlNode[] {
  const converted = new WeakMap<object, HtmlNode>();
  const stack: Array<{ readonly source: ConversionSource; readonly exiting: boolean }> = [];
  const roots = children(root, operation);
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const source = roots[index];
    if (source !== undefined) stack.push({ source, exiting: false });
  }

  while (stack.length > 0) {
    operation.checkpoint();
    const frame = stack.pop();
    if (frame === undefined) break;
    const descendants = sourceChildren(frame.source, operation);
    if (descendants.length > 0 && !frame.exiting) {
      stack.push({ source: frame.source, exiting: true });
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        const child = descendants[index];
        if (child !== undefined) stack.push({ source: child, exiting: false });
      }
      continue;
    }

    const source = frame.source;
    let node: HtmlNode;
    if (source.kind === "template-contents") {
      const templateChildren = Object.freeze(children(source, operation).map((child) => {
        operation.checkpoint();
        return requireInternalValue(
          converted.get(child),
          "PRODUCT_ADAPTER_CHILD_CONVERSION_MISSING"
        );
      }));
      node = Object.freeze({
        id: assigner.next(),
        kind: "templateContent",
        children: templateChildren,
        spanProvenance: "inferred"
      } satisfies TemplateContentNode);
    } else {
      const span = publicSpan(source.sourceSpan, captureSpans);
      const provenance = spanProvenance(source.sourceSpan, captureSpans);
      if (source.kind === "text") {
        node = Object.freeze({
          id: assigner.next(), kind: "text", value: source.data, spanProvenance: provenance,
          ...(span === undefined ? {} : { span })
        });
      } else if (source.kind === "comment") {
        node = Object.freeze({
          id: assigner.next(), kind: "comment", value: source.data, spanProvenance: provenance,
          ...(span === undefined ? {} : { span })
        });
      } else if (source.kind === "processing-instruction") {
        node = Object.freeze({
          id: assigner.next(), kind: "processingInstruction",
          target: source.target, data: source.data, spanProvenance: provenance,
          ...(span === undefined ? {} : { span })
        });
      } else if (source.kind === "doctype") {
        node = Object.freeze({
          id: assigner.next(), kind: "doctype", name: source.name,
          externalId: externalId(source.externalId), spanProvenance: provenance,
          ...(span === undefined ? {} : { span })
        });
      } else {
        const directChildren = Object.freeze(children(source, operation).map((child) => {
          operation.checkpoint();
          return requireInternalValue(
            converted.get(child),
            "PRODUCT_ADAPTER_CHILD_CONVERSION_MISSING"
          );
        }));
        const templateContent = source.templateContents === null
          ? undefined
          : converted.get(source.templateContents);
        if (templateContent !== undefined && templateContent.kind !== "templateContent") {
          failInternalState("PRODUCT_ADAPTER_TEMPLATE_CONTENT_KIND_MISMATCH");
        }
        node = Object.freeze({
          id: assigner.next(), kind: "element",
          namespaceUri: source.namespaceUri, prefix: source.prefix,
          localName: source.localName, tagName: source.qualifiedName,
          attributes: attributes(source, captureSpans, operation), children: directChildren,
          ...(templateContent === undefined ? {} : { templateContent }),
          spanProvenance: provenance,
          ...(span === undefined ? {} : { span })
        });
      }
    }
    converted.set(source, node);
  }

  return Object.freeze(roots.map((source) => {
    operation.checkpoint();
    return requireInternalValue(
      converted.get(source),
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
  const publicChildren = convertNodes(result.model.root, assigner, captureSpans, operation);
  const validation = result.model.validate();
  const errors = parseErrors(result.parseErrors, operation);
  trace.emit({
    kind: "tree-mutation",
    nodeCount: validation.attachedNodes,
    errorCount: errors.length
  });
  trace.emitBudget("maxNodes", budgets?.maxNodes, result.resources.nodes);
  trace.emitBudget("maxDepth", budgets?.maxDepth, result.resources.maxDepth);
  const traceResult = trace.finish({
    tokenCount,
    nodeCount: validation.attachedNodes,
    maxDepth: validation.maxDepth,
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

/** Staged independent implementation of the public text parse contract. */
export function parseWithIndependentEngine(html: string, options: ParseOptions = {}): ParsedDocument {
  const startedAt = performance.now();
  const normalized = normalizeParseOptions(options);
  requireString(html, "input");
  const operation = createOperationContext(normalized.budgets?.maxTimeMs, normalized.signal, startedAt);
  operation.checkpoint();
  return parseDocumentOperation(html, normalized, stringInputContext(html, operation, startedAt));
}

/** Staged independent implementation of the public byte parse contract. */
export function parseBytesWithIndependentEngine(
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

/** Staged independent implementation of the public fragment parse contract. */
export function parseFragmentWithIndependentEngine(
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
  const publicChildren = convertNodes(result.model.root, assigner, normalized.captureSpans ?? false, operation);
  const validation = result.model.validate();
  const errors = parseErrors(result.parseErrors, operation);
  trace.emit({ kind: "tree-mutation", nodeCount: validation.attachedNodes, errorCount: errors.length });
  trace.emitBudget("maxNodes", normalized.budgets?.maxNodes, result.resources.nodes);
  trace.emitBudget("maxDepth", normalized.budgets?.maxDepth, result.resources.maxDepth);
  const traceResult = trace.finish({
    tokenCount,
    nodeCount: validation.attachedNodes,
    maxDepth: validation.maxDepth,
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

const independentTextOperations = createTextOperations(parseFragmentWithIndependentEngine);

/** Staged text iteration whose nested markup stays on the independent engine. */
export const iterateTextWithIndependentEngine = independentTextOperations.iterateText;

/** Staged text extraction whose nested markup stays on the independent engine. */
export const extractTextWithIndependentEngine = independentTextOperations.extractText;

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

/** Staged independent implementation of eager byte-stream tokenization. */
export async function tokenizeByteStreamEagerWithIndependentEngine(
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
      return Object.freeze({ selfClosingAcknowledged: token.kind !== "start-tag" || token.selfClosing });
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

/** Staged independent implementation of the public byte-stream parse contract. */
export async function parseStreamWithIndependentEngine(
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
