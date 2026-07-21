import {
  failInternalState,
  requireInternalValue
} from "../internal/foundation/internal-state-error.ts";
import { isHtmlParseErrorCode } from "../internal/foundation/parse-error-codes.ts";
import {
  createHtmlEngineSession,
  runHtmlEngine
} from "../internal/html-engine/parser-driver.ts";
import {
  EngineAbortError,
  EngineResourceLimitError,
  createEngineResourceGuard
} from "../internal/html-engine/resource-guard.ts";
import { HtmlTokenizer } from "../internal/html-engine/tokenizer/tokenizer.ts";

import { enforceBudget } from "./budgets.ts";
import { HtmlAbortError, HtmlBudgetExceededError } from "./errors.ts";
import { normalizeFragmentContext, toEngineFragmentContext } from "./fragment-context.ts";
import {
  decodeByteArray,
  decodeByteStream,
  requireByteArray,
  requireReadableByteStream,
  requireString,
  utf8ByteLength
} from "./html-input.ts";
import { HTML_NAMESPACE_URI } from "./model.ts";
import {
  createOperationContext,
  normalizeParseBytesOptions,
  normalizeParseFragmentOptions,
  normalizeParseOptions,
  normalizeParseStreamOptions,
  normalizeTokenizeByteStreamEagerOptions
} from "./operation.ts";
import { normalizeParseErrorId, TraceSink } from "./parse-trace.ts";
import {
  registerParsedDocument,
  registerParsedFragmentTree
} from "./parsed-output-registry.ts";

import type { OperationContext } from "./operation.ts";
import type {
  Attribute,
  DocumentTree,
  FragmentTree,
  HtmlFragmentContextInput,
  HtmlBudgetName,
  HtmlNode,
  NodeId,
  ParseBytesOptions,
  ParseFragmentOptions,
  ParsedFragment,
  ParseOptions,
  ParsedDocument,
  ParseMetadata,
  ParseResourceUsage,
  ParseStreamOptions,
  Span,
  SpanProvenance,
  TemplateContentNode,
  Token,
  TokenizeByteStreamEagerResult,
  TokenizeByteStreamEagerOptions
} from "./types.ts";
import type {
  EngineParseError
} from "../internal/html-engine/diagnostics.ts";
import type {
  HtmlEngineProductResult,
  HtmlEngineSession
} from "../internal/html-engine/parser-driver.ts";
import type { SourceSpan } from "../internal/html-engine/positions.ts";
import type {
  EngineResourceLimitName,
  EngineResourceLimits
} from "../internal/html-engine/resource-guard.ts";
import type { HtmlToken } from "../internal/html-engine/tokens.ts";
import type {
  HtmlTemplateContents,
  HtmlTreeDoctypeExternalId,
  HtmlTreeElement,
  HtmlTreeModel,
  HtmlTreeNode,
  HtmlTreeParent,
  HtmlTreeRoot
} from "../internal/html-engine/tree-model.ts";

interface ParseInputContext {
  readonly inputKind: ParseMetadata["inputKind"];
  readonly byteLength: number;
  readonly decodedUtf8ByteLength: number;
  readonly decodedCodeUnits: number;
  readonly transportByteLength: number | null;
  readonly metadataEncoding: ParseMetadata["encoding"];
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
const WHATWG_PARSE_ERROR_ANCHOR_URL =
  "https://html.spec.whatwg.org/multipage/parsing.html#parse-error-";

/** Returns the most specific HTML Standard reference available for a parser diagnostic. */
export function getParseErrorSpecRef(parseErrorId: string): string {
  return isHtmlParseErrorCode(parseErrorId)
    ? `${WHATWG_PARSE_ERROR_ANCHOR_URL}${parseErrorId}`
    : WHATWG_PARSE_ERRORS_SECTION_URL;
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
  return resource;
}

function engineLimits(options: ParseOptions["budgets"]): EngineResourceLimits {
  if (options === undefined) return Object.freeze({});
  return Object.freeze({
    ...(options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes }),
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
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

function spanProvenance(
  span: SourceSpan | null,
  captureSpans: boolean
): SpanProvenance | undefined {
  if (!captureSpans) return undefined;
  return span === null ? "inferred" : "input";
}

function children(
  parent: HtmlTreeParent,
  model: HtmlTreeModel,
  operation: OperationContext
): readonly HtmlTreeNode[] {
  const result: HtmlTreeNode[] = [];
  for (const child of model.childrenOf(parent)) {
    if (operation.interruptible) operation.checkpoint();
    result.push(child);
  }
  return result;
}

const EMPTY_ATTRIBUTES: readonly Attribute[] = Object.freeze([]);

function attributes(
  element: HtmlTreeElement,
  model: HtmlTreeModel,
  captureSpans: boolean,
  names: Map<string, string>,
  operation: OperationContext
): readonly Attribute[] {
  const sourceAttributes = model.attributesOf(element);
  if (sourceAttributes.length === 0) return EMPTY_ATTRIBUTES;
  const result = new Array<Attribute>(sourceAttributes.length);
  let index = 0;
  for (const attribute of sourceAttributes) {
    if (operation.interruptible) operation.checkpoint();
    const span = publicSpan(attribute.sourceSpan, captureSpans);
    result[index] = Object.freeze({
      namespaceUri: attribute.namespaceUri,
      ...(attribute.prefix === null ? {} : { prefix: intern(names, attribute.prefix) }),
      localName: intern(names, attribute.localName),
      value: internShort(names, attribute.value),
      ...(span === undefined ? {} : { span })
    });
    index += 1;
  }
  return Object.freeze(result);
}

function intern(values: Map<string, string>, value: string): string {
  const retained = values.get(value);
  if (retained !== undefined) return retained;
  values.set(value, value);
  return value;
}

function internShort(values: Map<string, string>, value: string): string {
  return value.length <= 64 ? intern(values, value) : value;
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
    if (operation.interruptible) operation.checkpoint();
    result.push(requireInternalValue(
      converted[child.identity.serial],
      "PUBLIC_PARSER_CHILD_CONVERSION_MISSING"
    ));
  }
  return Object.freeze(result);
}

function finishPublicNode<T extends object>(
  node: T,
  provenance: SpanProvenance | undefined,
  span: Span | undefined
): Readonly<T> {
  const mutable = node as T & { spanProvenance?: SpanProvenance; span?: Span };
  if (provenance !== undefined) mutable.spanProvenance = provenance;
  if (span !== undefined) mutable.span = span;
  return Object.freeze(node);
}

function createUnspannedPublicNode(
  source: ConversionSource,
  model: HtmlTreeModel,
  assigner: NodeIdAssigner,
  names: Map<string, string>,
  directChildren: readonly HtmlNode[],
  templateContent: HtmlNode | undefined,
  operation: OperationContext
): HtmlNode {
  if (source.kind === "template-contents") {
    return Object.freeze({
      id: assigner.next(),
      kind: "templateContent" as const,
      children: directChildren
    });
  }
  if (source.kind === "text") {
    return Object.freeze({
      id: assigner.next(), kind: "text" as const, value: internShort(names, source.data)
    });
  }
  if (source.kind === "comment") {
    return Object.freeze({
      id: assigner.next(), kind: "comment" as const, value: internShort(names, source.data)
    });
  }
  if (source.kind === "processing-instruction") {
    return Object.freeze({
      id: assigner.next(), kind: "processingInstruction" as const,
      target: source.target, data: source.data
    });
  }
  if (source.kind === "doctype") {
    return Object.freeze({
      id: assigner.next(), kind: "doctype" as const, name: source.name,
      externalId: externalId(source.externalId)
    });
  }
  if (templateContent !== undefined && templateContent.kind !== "templateContent") {
    failInternalState("PUBLIC_PARSER_TEMPLATE_CONTENT_KIND_MISMATCH");
  }
  const element = {
    id: assigner.next(), kind: "element" as const,
    namespaceUri: source.namespaceUri,
    ...(source.prefix === null ? {} : { prefix: intern(names, source.prefix) }),
    localName: intern(names, source.localName),
    attributes: attributes(source, model, false, names, operation), children: directChildren
  } as {
    id: NodeId;
    kind: "element";
    namespaceUri: string;
    prefix?: string;
    localName: string;
    attributes: readonly Attribute[];
    children: readonly HtmlNode[];
    templateContent?: TemplateContentNode;
  };
  if (templateContent !== undefined) element.templateContent = templateContent;
  return Object.freeze(element);
}

function createPublicNode(
  source: ConversionSource,
  model: HtmlTreeModel,
  assigner: NodeIdAssigner,
  captureSpans: boolean,
  names: Map<string, string>,
  directChildren: readonly HtmlNode[],
  templateContent: HtmlNode | undefined,
  operation: OperationContext
): HtmlNode {
  if (!captureSpans) {
    return createUnspannedPublicNode(
      source,
      model,
      assigner,
      names,
      directChildren,
      templateContent,
      operation
    );
  }
  if (source.kind === "template-contents") {
    return finishPublicNode({
      id: assigner.next(),
      kind: "templateContent" as const,
      children: directChildren
    } satisfies Omit<TemplateContentNode, "spanProvenance">, "inferred", undefined);
  }
  const span = publicSpan(source.sourceSpan, captureSpans);
  const provenance = spanProvenance(source.sourceSpan, captureSpans);
  if (source.kind === "text") {
    return finishPublicNode({
      id: assigner.next(), kind: "text" as const, value: internShort(names, source.data)
    }, provenance, span);
  }
  if (source.kind === "comment") {
    return finishPublicNode({
      id: assigner.next(), kind: "comment" as const, value: internShort(names, source.data)
    }, provenance, span);
  }
  if (source.kind === "processing-instruction") {
    return finishPublicNode({
      id: assigner.next(), kind: "processingInstruction" as const,
      target: source.target, data: source.data
    }, provenance, span);
  }
  if (source.kind === "doctype") {
    return finishPublicNode({
      id: assigner.next(), kind: "doctype" as const, name: source.name,
      externalId: externalId(source.externalId)
    }, provenance, span);
  }
  if (templateContent !== undefined && templateContent.kind !== "templateContent") {
    failInternalState("PUBLIC_PARSER_TEMPLATE_CONTENT_KIND_MISMATCH");
  }
  const element = {
    id: assigner.next(), kind: "element" as const,
    namespaceUri: source.namespaceUri,
    ...(source.prefix === null ? {} : { prefix: intern(names, source.prefix) }),
    localName: intern(names, source.localName),
    attributes: attributes(source, model, captureSpans, names, operation), children: directChildren
  } as {
    id: NodeId;
    kind: "element";
    namespaceUri: string;
    prefix?: string;
    localName: string;
    attributes: readonly Attribute[];
    children: readonly HtmlNode[];
    templateContent?: TemplateContentNode;
  };
  if (templateContent !== undefined) element.templateContent = templateContent;
  return finishPublicNode(element, provenance, span);
}

function releaseConvertedSource(source: ConversionSource, model: HtmlTreeModel): void {
  if (source.kind === "element") {
    model.releaseExportedAttributes(source);
    model.releaseExportedChildren(source);
  } else if (source.kind === "template-contents") {
    model.releaseExportedChildren(source);
  }
}

function convertReadySource(
  source: ConversionSource,
  model: HtmlTreeModel,
  converted: readonly (HtmlNode | undefined)[],
  assigner: NodeIdAssigner,
  captureSpans: boolean,
  names: Map<string, string>,
  operation: OperationContext
): HtmlNode {
  const directChildren = source.kind === "template-contents" ||
      (source.kind === "element" && source.templateContents === null)
    ? convertedChildren(source, model, converted, operation)
    : EMPTY_HTML_NODES;
  const templateContent = source.kind === "element" && source.templateContents !== null
    ? converted[source.templateContents.identity.serial]
    : undefined;
  const node = createPublicNode(
    source,
    model,
    assigner,
    captureSpans,
    names,
    directChildren,
    templateContent,
    operation
  );
  releaseConvertedSource(source, model);
  return node;
}

function convertRecursively(
  source: ConversionSource,
  model: HtmlTreeModel,
  assigner: NodeIdAssigner,
  captureSpans: boolean,
  names: Map<string, string>,
  operation: OperationContext
): HtmlNode {
  if (operation.interruptible) operation.checkpoint();
  let directChildren = EMPTY_HTML_NODES;
  let templateContent: HtmlNode | undefined;
  if (source.kind === "element" && source.templateContents !== null) {
    templateContent = convertRecursively(
      source.templateContents,
      model,
      assigner,
      captureSpans,
      names,
      operation
    );
  } else if (source.kind === "element" || source.kind === "template-contents") {
    const sourceChildren = model.childrenOf(source);
    if (sourceChildren.length > 0) {
      const convertedChildren = new Array<HtmlNode>(sourceChildren.length);
      let index = 0;
      for (const child of sourceChildren) {
        convertedChildren[index] = convertRecursively(
          child,
          model,
          assigner,
          captureSpans,
          names,
          operation
        );
        index += 1;
      }
      directChildren = Object.freeze(convertedChildren);
    }
  }
  const node = createPublicNode(
    source,
    model,
    assigner,
    captureSpans,
    names,
    directChildren,
    templateContent,
    operation
  );
  releaseConvertedSource(source, model);
  return node;
}

function convertNodes(
  root: HtmlTreeRoot,
  model: HtmlTreeModel,
  assigner: NodeIdAssigner,
  captureSpans: boolean,
  maxDepth: number,
  operation: OperationContext
): readonly HtmlNode[] {
  const converted: (HtmlNode | undefined)[] = [];
  const names = new Map<string, string>();
  const roots = children(root, model, operation);
  model.releaseExportedChildren(root);
  if (maxDepth <= 128) {
    return Object.freeze(roots.map((source) =>
      convertRecursively(
        source,
        model,
        assigner,
        captureSpans,
        names,
        operation
      )
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
      if (operation.interruptible) operation.checkpoint();
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
          names,
          operation
        );
      }
    }
  }

  return Object.freeze(roots.map((source) => {
    if (operation.interruptible) operation.checkpoint();
    return requireInternalValue(
      converted[source.identity.serial],
      "PUBLIC_PARSER_ROOT_CONVERSION_MISSING"
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
    if (operation.interruptible) operation.checkpoint();
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
    decodedCodeUnits: html.length,
    transportByteLength: null,
    metadataEncoding: { name: null, source: "already-decoded" },
    encodingPrescanBytes: 0,
    operation,
    startedAt,
    decode: { source: "input", encoding: "utf-8", sniffSource: "input" }
  };
}

interface DocumentEngineState {
  tokenCount: number;
  previousCharacter: boolean;
}

function createDocumentEngine(
  options: ParseOptions | ParseBytesOptions | ParseStreamOptions,
  startedAt: number,
  trace: TraceSink
): { readonly session: HtmlEngineSession; readonly state: DocumentEngineState } {
  const state: DocumentEngineState = { tokenCount: 0, previousCharacter: false };
  const session = createHtmlEngineSession({
    retainNodeSpans: options.captureSpans ?? false,
    trackSteps: options.budgets?.maxSteps !== undefined,
    parser: { kind: "document", scriptingMode: options.scriptingMode ?? "inert" },
    limits: engineLimits(options.budgets),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    startedAt,
    ...(trace.active
      ? {
          observer: {
            onToken(token): void {
              if (token.kind !== "character" || !state.previousCharacter) {
                state.tokenCount += 1;
              }
              state.previousCharacter = token.kind === "character";
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
  return { session, state };
}

function finishDocumentOperation(
  sourceText: string | null,
  options: ParseOptions | ParseBytesOptions | ParseStreamOptions,
  input: ParseInputContext,
  trace: TraceSink,
  result: HtmlEngineProductResult,
  tokenCount: number
): ParsedDocument {
  const operation = input.operation;
  const budgets = options.budgets;
  const captureSpans = options.captureSpans ?? false;
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
  if (budgets?.maxSteps !== undefined) {
    trace.emitBudget("maxSteps", budgets.maxSteps, result.resources.steps);
  }
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
    scriptingMode: options.scriptingMode ?? "inert",
    children: publicChildren,
    errors,
    ...(traceResult === undefined ? {} : { trace: traceResult })
  });
  const resourceUsage: ParseResourceUsage = Object.freeze({
    inputBytes: input.byteLength,
    decodedUtf8Bytes: input.decodedUtf8ByteLength,
    decodedCodeUnits: input.decodedCodeUnits,
    steps: budgets?.maxSteps === undefined ? null : result.resources.steps,
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
    sourceText,
    metadata: Object.freeze({
      inputKind: input.inputKind,
      transportByteLength: input.transportByteLength,
      encoding: Object.freeze({ ...input.metadataEncoding }),
      resourceUsage
    })
  });
  registerParsedDocument(parsed, sourceText, captureSpans);
  return parsed;
}

function fragmentResourceUsage(
  inputBytes: number,
  decodedCodeUnits: number,
  budgets: ParseFragmentOptions["budgets"],
  result: HtmlEngineProductResult,
  trace: TraceSink
): ParseResourceUsage {
  return Object.freeze({
    inputBytes,
    decodedUtf8Bytes: inputBytes,
    decodedCodeUnits,
    steps: budgets?.maxSteps === undefined ? null : result.resources.steps,
    nodes: result.resources.nodes,
    maxDepth: result.resources.maxDepth,
    parseErrors: result.resources.parseErrors,
    attributes: result.resources.attributes,
    attributeUtf8Bytes: result.resources.attributeUtf8Bytes,
    encodingPrescanBytes: 0,
    traceEvents: trace.eventCount,
    traceUtf8Bytes: trace.eventUtf8Bytes
  });
}

function parseDocumentOperation(
  html: string,
  options: ParseOptions | ParseBytesOptions | ParseStreamOptions,
  input: ParseInputContext
): ParsedDocument {
  const operation = input.operation;
  const budgets = options.budgets;
  const trace = new TraceSink(options.trace ?? "none", options.onTraceEvent, budgets, operation);
  enforceBudget("maxInputBytes", budgets?.maxInputBytes, input.byteLength);
  enforceBudget("maxDecodedUtf8Bytes", budgets?.maxDecodedUtf8Bytes, input.decodedUtf8ByteLength);
  trace.emit({ kind: "decode", ...input.decode });
  if (input.stream !== undefined) trace.emit({ kind: "stream", ...input.stream });
  trace.emitBudget("maxInputBytes", budgets?.maxInputBytes, input.byteLength);

  let engine: ReturnType<typeof createDocumentEngine>;
  let result: HtmlEngineProductResult;
  try {
    engine = createDocumentEngine(options, input.startedAt, trace);
    engine.session.write(html);
    result = engine.session.finishForPublicConversion();
  } catch (error) {
    return mapEngineFailure(error);
  }
  return finishDocumentOperation(
    options.sourceRetention === "text" ? html : null,
    options,
    input,
    trace,
    result,
    engine.state.tokenCount
  );
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
  const trace = new TraceSink(
    normalized.trace ?? "none",
    normalized.onTraceEvent,
    normalized.budgets,
    operation
  );
  let engine: ReturnType<typeof createDocumentEngine> | undefined;
  let decoded;
  try {
    decoded = decodeByteArray(bytes, {
      retainText: normalized.sourceRetention === "text",
      ...(normalized.transportEncodingLabel === undefined
        ? {}
        : { transportEncodingLabel: normalized.transportEncodingLabel }),
      ...(normalized.budgets?.maxDecodedUtf8Bytes === undefined
        ? {}
        : { maxDecodedUtf8Bytes: normalized.budgets.maxDecodedUtf8Bytes }),
      onEncodingSniff(sniff): void {
        trace.emit({
          kind: "decode",
          source: "sniff",
          encoding: sniff.encoding,
          sniffSource: sniff.source
        });
        engine = createDocumentEngine(normalized, startedAt, trace);
      },
      onDecodedChunk(chunk): void {
        requireInternalValue(
          engine,
          "PUBLIC_PARSER_BYTES_ENGINE_NOT_INITIALIZED"
        ).session.write(chunk);
      }
    }, operation);
  } catch (error) {
    return mapEngineFailure(error);
  }
  const activeEngine = requireInternalValue(
    engine,
    "PUBLIC_PARSER_BYTES_ENGINE_NOT_INITIALIZED"
  );
  let result: HtmlEngineProductResult;
  try {
    result = activeEngine.session.finishForPublicConversion();
  } catch (error) {
    return mapEngineFailure(error);
  }
  trace.emitBudget("maxInputBytes", normalized.budgets?.maxInputBytes, bytes.byteLength);
  return finishDocumentOperation(decoded.text, normalized, {
    inputKind: "bytes",
    byteLength: bytes.byteLength,
    decodedUtf8ByteLength: decoded.decodedUtf8Bytes,
    decodedCodeUnits: decoded.decodedCodeUnits,
    transportByteLength: bytes.byteLength,
    metadataEncoding: { name: decoded.sniff.encoding, source: decoded.sniff.source },
    encodingPrescanBytes: 0,
    operation,
    startedAt,
    decode: { source: "sniff", encoding: decoded.sniff.encoding, sniffSource: decoded.sniff.source }
  }, trace, result, activeEngine.state.tokenCount);
}

/**
 * Parses an HTML fragment using the supplied namespace-aware context element.
 *
 * @example
 * ```ts
 * import { HTML_NAMESPACE_URI, parseFragment } from "jsr:@ismail-elkorchi/html-parser";
 *
 * const fragment = parseFragment("<td>Cell", {
 *   namespaceUri: HTML_NAMESPACE_URI,
 *   localName: "tr"
 * });
 * console.log(fragment.tree.children.length);
 * ```
 */
export function parseFragment(
  html: string,
  contextInput: HtmlFragmentContextInput,
  options: ParseFragmentOptions = {}
): ParsedFragment {
  const startedAt = performance.now();
  const normalized = normalizeParseFragmentOptions(options);
  requireString(html, "input");
  const context = normalizeFragmentContext(contextInput);
  const hasFormInContextChain = (normalized.hasFormAncestor ?? false) ||
    (context.namespaceUri === HTML_NAMESPACE_URI && context.localName === "form");
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
      trackSteps: normalized.budgets?.maxSteps !== undefined,
      parser: {
        kind: "fragment",
        scriptingMode: normalized.scriptingMode ?? "inert",
        documentMode: normalized.documentMode ?? "no-quirks",
        hasFormInContextChain,
        context: toEngineFragmentContext(context)
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
  if (normalized.budgets?.maxSteps !== undefined) {
    trace.emitBudget("maxSteps", normalized.budgets.maxSteps, result.resources.steps);
  }
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
  const tree: FragmentTree = Object.freeze({
    id: fragmentId,
    kind: "fragment",
    context,
    scriptingMode: normalized.scriptingMode ?? "inert",
    documentMode: normalized.documentMode ?? "no-quirks",
    hasFormInContextChain,
    children: publicChildren,
    errors,
    ...(traceResult === undefined ? {} : { trace: traceResult })
  });
  registerParsedFragmentTree(tree);
  return Object.freeze({
    tree,
    metadata: Object.freeze({
      inputKind: "text",
      transportByteLength: null,
      encoding: Object.freeze({ name: null, source: "already-decoded" }),
      resourceUsage: fragmentResourceUsage(
        inputBytes,
        html.length,
        normalized.budgets,
        result,
        trace
      )
    })
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
): Promise<TokenizeByteStreamEagerResult> {
  const startedAt = performance.now();
  const normalized = normalizeTokenizeByteStreamEagerOptions(options);
  requireReadableByteStream(stream, "input");
  const operation = createOperationContext(normalized.budgets?.maxTimeMs, normalized.signal, startedAt);
  operation.checkpoint();
  const limits: EngineResourceLimits = Object.freeze({
    ...(normalized.budgets?.maxSteps === undefined
      ? {}
      : { maxSteps: normalized.budgets.maxSteps }),
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
    startedAt,
    trackSteps: normalized.budgets?.maxSteps !== undefined
  });
  const tokens: Token[] = [];
  const tokenizer = new HtmlTokenizer(resources, {
    accept(token) {
      operation.checkpoint();
      tokens.push(publicToken(token, operation));
      return token.kind !== "start-tag" || token.selfClosing;
    }
  }, { reuseInputCharacters: true });
  let decoded;
  try {
    decoded = await decodeByteStream(stream, {
      ...normalized,
      retainText: false,
      onDecodedChunk(chunk): void { tokenizer.write(chunk); }
    }, operation);
    tokenizer.close();
  } catch (error) {
    return mapEngineFailure(error);
  }
  operation.checkpoint();
  const usage = resources.snapshot();
  return Object.freeze({
    tokens: Object.freeze(tokens),
    metadata: Object.freeze({
      inputKind: "stream",
      transportByteLength: decoded.totalBytes,
      encoding: Object.freeze({ name: decoded.sniff.encoding, source: decoded.sniff.source }),
      resourceUsage: Object.freeze({
        inputBytes: decoded.totalBytes,
        decodedUtf8Bytes: decoded.decodedUtf8Bytes,
        decodedCodeUnits: decoded.decodedCodeUnits,
        steps: normalized.budgets?.maxSteps === undefined ? null : usage.steps,
        parseErrors: usage.parseErrors,
        attributes: usage.attributes,
        attributeUtf8Bytes: usage.attributeUtf8Bytes,
        encodingPrescanBytes: decoded.encodingPrescanBytes
      })
    })
  });
}

/**
 * Reads, decodes, and incrementally parses a byte stream, resolving after EOF.
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
  const trace = new TraceSink(
    normalized.trace ?? "none",
    normalized.onTraceEvent,
    normalized.budgets,
    operation
  );
  let engine: ReturnType<typeof createDocumentEngine> | undefined;
  let decoded;
  try {
    decoded = await decodeByteStream(stream, {
      ...normalized,
      retainText: normalized.sourceRetention === "text",
      onEncodingSniff(sniff): void {
        trace.emit({
          kind: "decode",
          source: "sniff",
          encoding: sniff.encoding,
          sniffSource: sniff.source
        });
        engine = createDocumentEngine(normalized, startedAt, trace);
      },
      onDecodedChunk(chunk): void {
        requireInternalValue(
          engine,
          "PUBLIC_PARSER_STREAM_ENGINE_NOT_INITIALIZED"
        ).session.write(chunk);
      }
    }, operation);
  } catch (error) {
    return mapEngineFailure(error);
  }
  const activeEngine = requireInternalValue(
    engine,
    "PUBLIC_PARSER_STREAM_ENGINE_NOT_INITIALIZED"
  );
  let result: HtmlEngineProductResult;
  try {
    result = activeEngine.session.finishForPublicConversion();
  } catch (error) {
    return mapEngineFailure(error);
  }
  trace.emit({
    kind: "stream",
    bytesRead: decoded.totalBytes,
    encodingPrescanBytes: decoded.encodingPrescanBytes,
    encodingPrescanLimitBytes: decoded.encodingPrescanLimitBytes
  });
  trace.emitBudget("maxInputBytes", normalized.budgets?.maxInputBytes, decoded.totalBytes);
  return finishDocumentOperation(decoded.text, normalized, {
    inputKind: "stream",
    byteLength: decoded.totalBytes,
    decodedUtf8ByteLength: decoded.decodedUtf8Bytes,
    decodedCodeUnits: decoded.decodedCodeUnits,
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
  }, trace, result, activeEngine.state.tokenCount);
}
