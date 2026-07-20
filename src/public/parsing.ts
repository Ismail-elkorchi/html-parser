import { decodeHtmlBytes } from "../internal/encoding/mod.js";
import { requireInternalValue } from "../internal/foundation/internal-state-error.js";
import { tokenize, type HtmlToken } from "../internal/tokenizer/mod.js";
import {
  buildTreeFromHtml,
  TreeBudgetExceededError,
  type TreeAttribute,
  type TreeBuildOptions,
  type TreeBuildResult,
  type TreeBudgets,
  type TreeNode,
  type TreeSpan
} from "../internal/tree/mod.js";

import { enforceBudget } from "./budgets.js";
import {
  HtmlBudgetExceededError,
  HtmlConfigurationError
} from "./errors.js";
import {
  DecodedUtf8BudgetCounter,
  decodeStreamToText,
  requireByteArray,
  requireReadableByteStream,
  requireString,
  utf8ByteLength
} from "./html-input.js";
import { ownedChildNodes } from "./model.js";
import {
  createOperationContext,
  normalizeParseBytesOptions,
  normalizeParseFragmentOptions,
  normalizeParseOptions,
  normalizeParseStreamOptions,
  normalizeTokenizeByteStreamEagerOptions,
  type OperationContext
} from "./operation.js";
import { normalizeParseErrorId, TraceSink } from "./parse-trace.js";
import { registerParsedDocument } from "./parsed-document-registry.js";

import type {
  Attribute,
  DocumentTree,
  FragmentTree,
  HtmlNode,
  NodeId,
  ParseBudgetOptions,
  ParseBytesOptions,
  ParseError,
  ParseFragmentOptions,
  ParseOptions,
  ParsedDocument,
  ParsedDocumentMetadata,
  ParseResourceUsage,
  ParseStreamOptions,
  Span,
  SpanProvenance,
  Token,
  TokenizeByteStreamEagerOptions
} from "./types.js";

class NodeIdAssigner {
  #next: NodeId = 1;

  next(): NodeId {
    const value = this.#next;
    this.#next += 1;
    return value;
  }
}

interface NodeMetrics {
  readonly nodes: number;
  readonly maxDepth: number;
}

function parseOperationContext(options: ParseOptions, startedAt: number): OperationContext {
  return createOperationContext(options.budgets?.maxTimeMs, options.signal, startedAt);
}

function toPublicSpan(span: TreeSpan | undefined, captureSpans: boolean): Span | undefined {
  if (!captureSpans || !span) {
    return undefined;
  }

  return Object.freeze({ start: span.start, end: span.end });
}

function toSpanProvenance(span: TreeSpan | undefined, captureSpans: boolean): SpanProvenance {
  if (!captureSpans) {
    return "none";
  }
  return span ? "input" : "inferred";
}

function toAttributes(
  attributes: readonly TreeAttribute[],
  captureSpans: boolean,
  operation: OperationContext
): readonly Attribute[] {
  return Object.freeze(attributes.map((attribute) => {
    operation.checkpoint();
    const span = toPublicSpan(attribute.span, captureSpans);
    return Object.freeze({
      namespaceUri: attribute.namespaceUri,
      prefix: attribute.prefix,
      localName: attribute.localName,
      name: attribute.name,
      value: attribute.value,
      ...(span ? { span } : {})
    });
  }));
}

const WHATWG_PARSE_ERRORS_SECTION_URL = "https://html.spec.whatwg.org/multipage/parsing.html#parse-errors";
/**
 * Returns deterministic public metadata for `getParseErrorSpecRef`.
 */


export function getParseErrorSpecRef(parseErrorId: string): string {
  void parseErrorId;
  return WHATWG_PARSE_ERRORS_SECTION_URL;
}

function toParseErrors(
  errors: readonly {
    readonly code: string;
    readonly startOffset?: number;
    readonly endOffset?: number;
  }[],
  operation: OperationContext
): readonly ParseError[] {
  return Object.freeze(errors.map((error) => {
    operation.checkpoint();
    const hasOffsets =
      typeof error.startOffset === "number" &&
      typeof error.endOffset === "number" &&
      error.startOffset >= 0 &&
      error.endOffset >= error.startOffset;
    const parseErrorId = normalizeParseErrorId(error.code);
    return Object.freeze({
      code: "PARSER_ERROR",
      parseErrorId,
      message: error.code,
      ...(hasOffsets
        ? {
            span: Object.freeze({
              start: error.startOffset,
              end: error.endOffset
            })
          }
        : {})
    });
  }));
}

function toToken(token: HtmlToken): Token {
  if (token.type === "StartTag") {
    const attributes = Object.entries(token.attributes).map(([name, value]) =>
      Object.freeze({ name, value })
    );
    return Object.freeze({
      kind: "startTag",
      name: token.name,
      attributes: Object.freeze(attributes),
      selfClosing: token.selfClosing
    });
  }

  if (token.type === "EndTag") {
    return Object.freeze({
      kind: "endTag",
      name: token.name
    });
  }

  if (token.type === "Character") {
    return Object.freeze({
      kind: "chars",
      value: token.data
    });
  }

  if (token.type === "Comment") {
    return Object.freeze({
      kind: "comment",
      value: token.data
    });
  }

  if (token.type === "Doctype") {
    return Object.freeze({
      kind: "doctype",
      name: token.name,
      publicId: token.publicId,
      systemId: token.systemId,
      forceQuirks: token.forceQuirks
    });
  }

  return Object.freeze({
    kind: "eof"
  });
}

function treeBudgetsFromParseOptions(budgets: ParseOptions["budgets"] | undefined): TreeBudgets | undefined {
  if (!budgets) {
    return undefined;
  }

  const next: TreeBudgets = {
    ...(budgets.maxNodes !== undefined ? { maxNodes: budgets.maxNodes } : {}),
    ...(budgets.maxDepth !== undefined ? { maxDepth: budgets.maxDepth } : {}),
    ...(budgets.maxParseErrors !== undefined ? { maxParseErrors: budgets.maxParseErrors } : {}),
    ...(budgets.maxAttributesPerElement !== undefined
      ? { maxAttributesPerElement: budgets.maxAttributesPerElement }
      : {}),
    ...(budgets.maxAttributeBytes !== undefined
      ? { maxAttributeBytes: budgets.maxAttributeBytes }
      : {})
  };

  return Object.keys(next).length > 0 ? next : undefined;
}

function enforceTokenAttributeBudgets(
  attributes: readonly Readonly<{ readonly name: string; readonly value: string }>[],
  budgets: Pick<ParseBudgetOptions, "maxAttributesPerElement" | "maxAttributeBytes"> | undefined
): void {
  enforceBudget(
    "maxAttributesPerElement",
    budgets?.maxAttributesPerElement,
    attributes.length
  );
  if (budgets?.maxAttributeBytes === undefined) {
    return;
  }
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const attribute of attributes) {
    bytes += encoder.encode(attribute.name).byteLength;
    bytes += encoder.encode(attribute.value).byteLength;
    enforceBudget("maxAttributeBytes", budgets.maxAttributeBytes, bytes);
  }
}

function buildHtmlTree(
  html: string,
  budgets: ParseOptions["budgets"] | undefined,
  options: TreeBuildOptions
): TreeBuildResult {
  try {
    return buildTreeFromHtml(html, treeBudgetsFromParseOptions(budgets), options);
  } catch (error) {
    if (error instanceof TreeBudgetExceededError) {
      throw new HtmlBudgetExceededError(error.budget, error.limit, error.actual);
    }
    throw error;
  }
}

function convertTreeNodes(
  nodes: readonly TreeNode[],
  assigner: NodeIdAssigner,
  captureSpans: boolean,
  operation: OperationContext
): readonly HtmlNode[] {
  const converted = new WeakMap<object, HtmlNode>();
  const stack: { readonly node: TreeNode; readonly exiting: boolean }[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node !== undefined) {
      stack.push({ node, exiting: false });
    }
  }

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) {
      continue;
    }
    operation.checkpoint();
    const { node } = frame;
    if (node.kind === "element" && !frame.exiting) {
      stack.push({ node, exiting: true });
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        if (child !== undefined) {
          stack.push({ node: child, exiting: false });
        }
      }
      continue;
    }

    const span = toPublicSpan(node.span, captureSpans);
    const spanProvenance = toSpanProvenance(node.span, captureSpans);
    let publicNode: HtmlNode;
    if (node.kind === "text") {
      publicNode = {
        id: assigner.next(), kind: "text", value: node.value, spanProvenance,
        ...(span ? { span } : {})
      };
    } else if (node.kind === "comment") {
      publicNode = {
        id: assigner.next(), kind: "comment", value: node.value, spanProvenance,
        ...(span ? { span } : {})
      };
    } else if (node.kind === "doctype") {
      publicNode = {
        id: assigner.next(), kind: "doctype", name: node.name,
        externalId: Object.freeze({ ...node.externalId }), spanProvenance,
        ...(span ? { span } : {})
      };
    } else {
      const children = Object.freeze(node.children.map((child) => {
        return requireInternalValue(
          converted.get(child),
          "PUBLIC_TREE_CHILD_CONVERSION_MISSING"
        );
      }));
      publicNode = {
        id: assigner.next(), kind: "element",
        namespaceUri: node.namespaceUri,
        prefix: node.prefix,
        localName: node.localName,
        tagName: node.name,
        attributes: toAttributes(node.attributes, captureSpans, operation),
        children, spanProvenance,
        ...(span ? { span } : {})
      };
    }
    converted.set(node, Object.freeze(publicNode));
  }

  return Object.freeze(nodes.map((node) => {
    return requireInternalValue(
      converted.get(node),
      "PUBLIC_TREE_ROOT_CONVERSION_MISSING"
    );
  }));
}

function collectMetrics(nodes: readonly HtmlNode[], operation: OperationContext): NodeMetrics {
  let totalNodes = 0;
  let maxDepth = 1;

  const stack: { readonly node: HtmlNode; readonly depth: number }[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node !== undefined) {
      stack.push({ node, depth: 2 });
    }
  }
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) {
      continue;
    }
    operation.checkpoint();
    totalNodes += 1;
    maxDepth = Math.max(maxDepth, entry.depth);
    const descendants = ownedChildNodes(entry.node);
    if (descendants.length > 0) {
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        const child = descendants[index];
        if (child !== undefined) {
          stack.push({ node: child, depth: entry.depth + 1 });
        }
      }
    }
  }

  return { nodes: totalNodes, maxDepth };
}

interface ParseInputContext {
  readonly inputKind: ParsedDocumentMetadata["inputKind"];
  readonly byteLength: number;
  readonly decodedUtf8ByteLength: number;
  readonly transportByteLength: number | null;
  readonly metadataEncoding: ParsedDocumentMetadata["encoding"];
  readonly encodingPrescanBytes: number;
  readonly operation: OperationContext;
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

function stringInputContext(html: string, operation: OperationContext): ParseInputContext {
  const byteLength = utf8ByteLength(html, operation);
  return {
    inputKind: "text",
    byteLength,
    decodedUtf8ByteLength: byteLength,
    transportByteLength: null,
    metadataEncoding: {
      name: null,
      source: "already-decoded"
    },
    encodingPrescanBytes: 0,
    operation,
    decode: {
      source: "input",
      encoding: "utf-8",
      sniffSource: "input"
    }
  };
}

function parseDocumentInternal(
  html: string,
  options: ParseOptions | ParseBytesOptions | ParseStreamOptions,
  input: ParseInputContext
): ParsedDocument {
  const operation = input.operation;
  const budgets = options.budgets;
  const captureSpans = options.captureSpans ?? false;
  const assigner = new NodeIdAssigner();
  const documentId = assigner.next();
  const traceSink = new TraceSink(
    options.trace ?? "none",
    options.onTraceEvent,
    budgets,
    operation
  );

  operation.checkpoint();
  enforceBudget("maxInputBytes", budgets?.maxInputBytes, input.byteLength);
  enforceBudget(
    "maxDecodedUtf8Bytes",
    budgets?.maxDecodedUtf8Bytes,
    input.decodedUtf8ByteLength
  );
  traceSink.emit({
    kind: "decode",
    ...input.decode
  });
  if (input.stream !== undefined) {
    traceSink.emit({
      kind: "stream",
      bytesRead: input.stream.bytesRead,
      encodingPrescanBytes: input.stream.encodingPrescanBytes,
      encodingPrescanLimitBytes: input.stream.encodingPrescanLimitBytes
    });
  }
  traceSink.emitBudget(
    "maxInputBytes",
    budgets?.maxInputBytes,
    input.byteLength
  );

  let tokenCount = 0;
  let previousTokenWasCharacter = false;

  const built = buildHtmlTree(html, budgets, {
    captureSpans,
    checkpoint(): void {
      operation.checkpoint();
    },
    ...(traceSink.active
      ? {
          onToken(kind: "startTag" | "endTag" | "comment" | "doctype" | "character" | "eof"): void {
            if (kind !== "character" || !previousTokenWasCharacter) {
              tokenCount += 1;
            }
            previousTokenWasCharacter = kind === "character";
          },
          onInsertionModeTransition(transition: {
            readonly fromMode: string;
            readonly toMode: string;
            readonly tokenType: string | null;
            readonly tokenTagName: string | null;
            readonly tokenStartOffset: number | null;
            readonly tokenEndOffset: number | null;
          }): void {
            traceSink.emit({
              kind: "insertionModeTransition",
              fromMode: transition.fromMode,
              toMode: transition.toMode,
              tokenContext: {
                type: transition.tokenType,
                tagName: transition.tokenTagName,
                startOffset: transition.tokenStartOffset,
                endOffset: transition.tokenEndOffset
              }
            });
          },
          onParseError(error: {
            readonly code: string;
            readonly startOffset?: number;
            readonly endOffset?: number;
          }): void {
            traceSink.emit({
              kind: "parseError",
              parseErrorId: normalizeParseErrorId(error.code),
              startOffset: typeof error.startOffset === "number" ? error.startOffset : null,
              endOffset: typeof error.endOffset === "number" ? error.endOffset : null
            });
          }
        }
      : {})
  });

  traceSink.emit({
    kind: "token",
    count: tokenCount
  });

  const children = convertTreeNodes(built.document.children, assigner, captureSpans, operation);
  const metrics = collectMetrics(children, operation);
  const totalNodes = metrics.nodes + 1;

  operation.checkpoint();

  traceSink.emit({
    kind: "tree-mutation",
    nodeCount: totalNodes,
    errorCount: built.errors.length
  });
  traceSink.emitBudget("maxNodes", budgets?.maxNodes, built.resourceUsage.nodes);
  traceSink.emitBudget("maxDepth", budgets?.maxDepth, built.resourceUsage.maxDepth);

  const errors = toParseErrors(built.errors, operation);
  const trace = traceSink.finish({
    tokenCount,
    nodeCount: totalNodes,
    maxDepth: metrics.maxDepth,
    parseErrorCount: built.errors.length,
    encoding: {
      name: input.decode.encoding,
      source: input.decode.sniffSource
    },
    inputBytes: input.byteLength,
    decodedUtf8Bytes: input.decodedUtf8ByteLength,
    bytesRead: input.stream?.bytesRead ?? null,
    encodingPrescanBytes: input.stream?.encodingPrescanBytes ?? null,
    encodingPrescanLimitBytes: input.stream?.encodingPrescanLimitBytes ?? null
  });

  const tree: DocumentTree = Object.freeze({
    id: documentId,
    kind: "document",
    children,
    errors,
    ...(trace === undefined ? {} : { trace })
  });
  const resourceUsage: ParseResourceUsage = Object.freeze({
    inputBytes: input.byteLength,
    decodedUtf8Bytes: input.decodedUtf8ByteLength,
    decodedCodeUnits: html.length,
    nodes: built.resourceUsage.nodes,
    maxDepth: built.resourceUsage.maxDepth,
    parseErrors: built.resourceUsage.parseErrors,
    attributes: built.resourceUsage.attributes,
    attributeUtf8Bytes: built.resourceUsage.attributeUtf8Bytes,
    encodingPrescanBytes: input.encodingPrescanBytes,
    traceEvents: traceSink.eventCount,
    traceUtf8Bytes: traceSink.eventUtf8Bytes
  });
  const metadata: ParsedDocumentMetadata = Object.freeze({
    inputKind: input.inputKind,
    transportByteLength: input.transportByteLength,
    encoding: Object.freeze({ ...input.metadataEncoding }),
    resourceUsage
  });
  const sourceText = options.sourceRetention === "text" ? html : null;
  const result: ParsedDocument = Object.freeze({
    tree,
    sourceText,
    metadata
  });
  registerParsedDocument(result, sourceText, captureSpans);
  return result;
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
  const normalizedOptions = normalizeParseOptions(options);
  requireString(html, "input");
  const operation = parseOperationContext(normalizedOptions, startedAt);
  operation.checkpoint();
  const input = stringInputContext(html, operation);
  operation.checkpoint();
  return parseDocumentInternal(html, normalizedOptions, input);
}

/** Sniffs, decodes, and parses a byte sequence as a complete HTML document. */
export function parseBytes(bytes: Uint8Array, options: ParseBytesOptions = {}): ParsedDocument {
  const startedAt = performance.now();
  const normalizedOptions = normalizeParseBytesOptions(options);
  requireByteArray(bytes, "input");
  const operation = parseOperationContext(normalizedOptions, startedAt);
  operation.checkpoint();
  enforceBudget("maxInputBytes", normalizedOptions.budgets?.maxInputBytes, bytes.byteLength);

  const decodedBudget = new DecodedUtf8BudgetCounter(
    normalizedOptions.budgets?.maxDecodedUtf8Bytes,
    operation
  );

  const decoded = decodeHtmlBytes(
    bytes,
    {
      ...(normalizedOptions.transportEncodingLabel
        ? { transportEncodingLabel: normalizedOptions.transportEncodingLabel }
        : {}),
      onDecodedChunk(chunk): void {
        decodedBudget.append(chunk);
      }
    }
  );
  operation.checkpoint();

  return parseDocumentInternal(decoded.text, normalizedOptions, {
    inputKind: "bytes",
    byteLength: bytes.byteLength,
    decodedUtf8ByteLength: decodedBudget.bytes,
    transportByteLength: bytes.byteLength,
    metadataEncoding: {
      name: decoded.sniff.encoding,
      source: decoded.sniff.source
    },
    encodingPrescanBytes: 0,
    operation,
    decode: {
      source: "sniff",
      encoding: decoded.sniff.encoding,
      sniffSource: decoded.sniff.source
    }
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
  const normalizedOptions = normalizeParseFragmentOptions(options);
  requireString(html, "input");
  requireString(contextTagName, "contextTagName");
  const budgets = normalizedOptions.budgets;
  const captureSpans = normalizedOptions.captureSpans ?? false;
  const normalizedContext = contextTagName.trim().toLowerCase();

  if (normalizedContext.length === 0) {
    throw new HtmlConfigurationError(
      "contextTagName",
      "INVALID_VALUE",
      "must be a non-empty tag name"
    );
  }

  const operation = parseOperationContext(normalizedOptions, startedAt);
  operation.checkpoint();

  const inputByteLength = utf8ByteLength(html, operation);
  enforceBudget("maxInputBytes", budgets?.maxInputBytes, inputByteLength);
  enforceBudget("maxDecodedUtf8Bytes", budgets?.maxDecodedUtf8Bytes, inputByteLength);

  const assigner = new NodeIdAssigner();
  const fragmentId = assigner.next();
  const traceSink = new TraceSink(
    normalizedOptions.trace ?? "none",
    normalizedOptions.onTraceEvent,
    budgets,
    operation
  );

  traceSink.emit({
    kind: "decode",
    source: "input",
    encoding: "utf-8",
    sniffSource: "input"
  });
  traceSink.emitBudget(
    "maxInputBytes",
    budgets?.maxInputBytes,
    inputByteLength
  );

  let tokenCount = 0;
  let previousTokenWasCharacter = false;

  const built = buildHtmlTree(html, budgets, {
    fragmentContextTagName: normalizedContext,
    captureSpans,
    checkpoint(): void {
      operation.checkpoint();
    },
    ...(traceSink.active
      ? {
          onToken(kind: "startTag" | "endTag" | "comment" | "doctype" | "character" | "eof"): void {
            if (kind !== "character" || !previousTokenWasCharacter) {
              tokenCount += 1;
            }
            previousTokenWasCharacter = kind === "character";
          },
          onInsertionModeTransition(transition: {
            readonly fromMode: string;
            readonly toMode: string;
            readonly tokenType: string | null;
            readonly tokenTagName: string | null;
            readonly tokenStartOffset: number | null;
            readonly tokenEndOffset: number | null;
          }): void {
            traceSink.emit({
              kind: "insertionModeTransition",
              fromMode: transition.fromMode,
              toMode: transition.toMode,
              tokenContext: {
                type: transition.tokenType,
                tagName: transition.tokenTagName,
                startOffset: transition.tokenStartOffset,
                endOffset: transition.tokenEndOffset
              }
            });
          },
          onParseError(error: {
            readonly code: string;
            readonly startOffset?: number;
            readonly endOffset?: number;
          }): void {
            traceSink.emit({
              kind: "parseError",
              parseErrorId: normalizeParseErrorId(error.code),
              startOffset: typeof error.startOffset === "number" ? error.startOffset : null,
              endOffset: typeof error.endOffset === "number" ? error.endOffset : null
            });
          }
        }
      : {})
  });

  traceSink.emit({
    kind: "token",
    count: tokenCount
  });

  const children = convertTreeNodes(built.document.children, assigner, captureSpans, operation);
  const metrics = collectMetrics(children, operation);
  const totalNodes = metrics.nodes + 1;

  operation.checkpoint();

  traceSink.emit({
    kind: "tree-mutation",
    nodeCount: totalNodes,
    errorCount: built.errors.length
  });
  traceSink.emitBudget("maxNodes", budgets?.maxNodes, built.resourceUsage.nodes);
  traceSink.emitBudget("maxDepth", budgets?.maxDepth, built.resourceUsage.maxDepth);

  const errors = toParseErrors(built.errors, operation);
  const trace = traceSink.finish({
    tokenCount,
    nodeCount: totalNodes,
    maxDepth: metrics.maxDepth,
    parseErrorCount: built.errors.length,
    encoding: { name: "utf-8", source: "input" },
    inputBytes: inputByteLength,
    decodedUtf8Bytes: inputByteLength,
    bytesRead: null,
    encodingPrescanBytes: null,
    encodingPrescanLimitBytes: null
  });

  return Object.freeze({
    id: fragmentId,
    kind: "fragment",
    contextTagName: normalizedContext,
    children,
    errors,
    ...(trace === undefined ? {} : { trace })
  });
}

async function tokenizeDecodedByteStreamEager(
  stream: ReadableStream<Uint8Array>,
  options: TokenizeByteStreamEagerOptions,
  operation: OperationContext
): Promise<readonly Token[]> {
  const decoded = await decodeStreamToText(stream, options, operation);
  let parseErrorCount = 0;
  let currentStartTagAttributeCount = 0;
  let currentStartTagAttributeBytes = 0;
  const encoder = new TextEncoder();
  const tokenized = tokenize(decoded.text, {
    checkpoint(): void {
      operation.checkpoint();
    },
    onParseError(): void {
      parseErrorCount += 1;
      enforceBudget("maxParseErrors", options.budgets?.maxParseErrors, parseErrorCount);
    },
    onStartTagOpen(): void {
      currentStartTagAttributeCount = 0;
      currentStartTagAttributeBytes = 0;
    },
    onStartTagAttribute(value, start): void {
      operation.checkpoint();
      if (start) {
        currentStartTagAttributeCount += 1;
        enforceBudget(
          "maxAttributesPerElement",
          options.budgets?.maxAttributesPerElement,
          currentStartTagAttributeCount
        );
      }
      currentStartTagAttributeBytes += encoder.encode(value).byteLength;
      enforceBudget(
        "maxAttributeBytes",
        options.budgets?.maxAttributeBytes,
        currentStartTagAttributeBytes
      );
    },
    onStartTag(attributes): void {
      enforceTokenAttributeBudgets(attributes, options.budgets);
    }
  });
  operation.checkpoint();

  const tokens: Token[] = [];
  for (const token of tokenized.tokens) {
    operation.checkpoint();
    tokens.push(toToken(token));
  }
  return tokens;
}

/**
 * Eagerly reads, decodes, and tokenizes a complete byte stream. The returned
 * promise resolves to one token collection after EOF and reader release.
 */
export async function tokenizeByteStreamEager(
  stream: ReadableStream<Uint8Array>,
  options: TokenizeByteStreamEagerOptions = {}
): Promise<readonly Token[]> {
  const startedAt = performance.now();
  const normalizedOptions = normalizeTokenizeByteStreamEagerOptions(options);
  requireReadableByteStream(stream, "input");
  const operation = createOperationContext(
    normalizedOptions.budgets?.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  return tokenizeDecodedByteStreamEager(stream, normalizedOptions, operation);
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
  const normalizedOptions = normalizeParseStreamOptions(options);
  requireReadableByteStream(stream, "input");
  const operation = parseOperationContext(normalizedOptions, startedAt);
  operation.checkpoint();
  const decoded = await decodeStreamToText(stream, normalizedOptions, operation);
  return parseDocumentInternal(decoded.text, normalizedOptions, {
    inputKind: "stream",
    byteLength: decoded.totalBytes,
    decodedUtf8ByteLength: decoded.decodedUtf8Bytes,
    transportByteLength: decoded.totalBytes,
    metadataEncoding: {
      name: decoded.sniff.encoding,
      source: decoded.sniff.source
    },
    encodingPrescanBytes: decoded.encodingPrescanBytes,
    operation,
    decode: {
      source: "sniff",
      encoding: decoded.sniff.encoding,
      sniffSource: decoded.sniff.source
    },
    stream: {
      bytesRead: decoded.totalBytes,
      encodingPrescanBytes: decoded.encodingPrescanBytes,
      encodingPrescanLimitBytes: decoded.encodingPrescanLimitBytes
    }
  });
}
