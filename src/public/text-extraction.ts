import { enforceBudget } from "./budgets.ts";
import {
  HtmlBudgetExceededError,
  isHtmlBudgetExceededError
} from "./errors.ts";
import { utf8ByteLength } from "./html-input.ts";
import {
  HTML_NAMESPACE_URI,
  OwnedNodeTracker,
  asciiLowercase,
  isHtmlElement
} from "./model.ts";
import {
  createOperationContext,
  normalizeTextExtractionOptions,
  type OperationContext
} from "./operation.ts";
import { parseFragment } from "./parsing.ts";
import {
  getAttributeValue,
  getAttributeValueNS
} from "./querying.ts";

import type {
  DocumentTree,
  FragmentTree,
  HtmlFragmentContextInput,
  HtmlNode,
  NodeId,
  ParseFragmentOptions,
  TextContentExtractionOptions,
  TextExtractionOptions,
  TextExtractionPolicy,
  TextExtractionResult,
  TextExtractionSourceNodeKind,
  TextExtractionSourceRole,
  TextExtractionToken,
  TextExtractionTokenKind,
  TextProvenanceRange,
  VisibleTextExtractionOptions
} from "./types.ts";

/** Stable semantic identity for visible HTML text extraction. */
export const VISIBLE_TEXT_HTML_POLICY = "visible-text-html-v1";
/** Stable semantic identity for raw DOM text-content extraction. */
export const TEXT_CONTENT_POLICY = "text-content-v1";

const VISIBLE_TEXT_SKIP_TAGS = new Set(["head", "script", "style", "template", "title", "optgroup", "option"]);
const VISIBLE_TEXT_INPUT_VALUE_TAG_TYPES = new Set(["button", "submit", "reset"]);
const VISIBLE_TEXT_BLOCK_BREAK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "nav",
  "ol",
  "section",
  "table",
  "tbody",
  "thead",
  "tfoot",
  "ul"
]);

type VisibleTextPolicyOptions = Required<
  Pick<
    VisibleTextExtractionOptions,
    "skipHiddenSubtrees" | "includeControlValues" | "includeAccessibleNameFallback" | "trim"
  >
>;

type ResolvedVisibleTextOptions = VisibleTextPolicyOptions & {
  readonly operation: OperationContext;
  readonly maxFallbackInputBytes: number;
  readonly maxFallbackNodes: number;
  readonly parseNestedFragment: (
    html: string,
    context: HtmlFragmentContextInput,
    options: ParseFragmentOptions
  ) => FragmentTree;
};

const DEFAULT_VISIBLE_TEXT_OPTIONS: VisibleTextPolicyOptions = Object.freeze({
  skipHiddenSubtrees: true,
  includeControlValues: true,
  includeAccessibleNameFallback: false,
  trim: true
});

function normalizeBooleanAttribute(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "true" || normalized === "1";
}

function attributeValue(node: Extract<HtmlNode, { kind: "element" }>, name: string): string | undefined {
  return node.namespaceUri === HTML_NAMESPACE_URI
    ? getAttributeValue(node, name)
    : getAttributeValueNS(node, null, name);
}

function shouldSkipHiddenSubtree(
  node: Extract<HtmlNode, { kind: "element" }>,
  options: ResolvedVisibleTextOptions
): boolean {
  options.operation.checkpoint();
  if (!options.skipHiddenSubtrees) {
    return false;
  }
  if (attributeValue(node, "hidden") !== undefined) {
    return true;
  }
  const inlineStyle = attributeValue(node, "style");
  if (inlineStyle) {
    const normalizedStyle = inlineStyle.toLowerCase().replace(/\s+/g, "");
    if (
      normalizedStyle.includes("display:none")
      || normalizedStyle.includes("visibility:hidden")
      || normalizedStyle.includes("content-visibility:hidden")
    ) {
      return true;
    }
  }
  return normalizeBooleanAttribute(attributeValue(node, "aria-hidden"));
}

function nonEmptyAttributeValue(
  node: Extract<HtmlNode, { kind: "element" }>,
  name: string
): string | undefined {
  const value = attributeValue(node, name);
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function accessibleNameFallback(
  node: Extract<HtmlNode, { kind: "element" }>,
  options: ResolvedVisibleTextOptions
): string | undefined {
  options.operation.checkpoint();
  if (!options.includeAccessibleNameFallback) {
    return undefined;
  }
  const tagName = node.localName.toLowerCase();
  if (tagName !== "input") {
    return undefined;
  }
  const type = (attributeValue(node, "type") ?? "text").trim().toLowerCase();
  if (type === "hidden") {
    return undefined;
  }
  return nonEmptyAttributeValue(node, "aria-label");
}

interface ExtractionSourceMeta {
  readonly sourceNodeId: NodeId | null;
  readonly sourceNodeKind: TextExtractionSourceNodeKind;
  readonly sourceRole: TextExtractionSourceRole;
}

interface ExtractionSourceChunk {
  readonly value: string;
  readonly normalizeSegment: boolean;
  readonly preserveWhitespace: boolean;
  readonly source: ExtractionSourceMeta;
}

function extractionSourceMetaFromNode(
  node: HtmlNode | DocumentTree | FragmentTree,
  sourceRole: TextExtractionSourceRole
): ExtractionSourceMeta {
  return {
    sourceNodeId: node.id,
    sourceNodeKind: node.kind,
    sourceRole
  };
}

function sameExtractionSource(left: ExtractionSourceMeta, right: ExtractionSourceMeta): boolean {
  return left.sourceNodeId === right.sourceNodeId &&
    left.sourceNodeKind === right.sourceNodeKind &&
    left.sourceRole === right.sourceRole;
}

function codePointUtf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

function scalarUtf8ByteLength(value: string): number {
  const codePoint = value.codePointAt(0);
  return codePoint === undefined ? 0 : codePointUtf8ByteLength(codePoint);
}

function* iterateStringScalars(
  value: string,
  operation: OperationContext
): IterableIterator<string> {
  let cursor = 0;
  while (cursor < value.length) {
    operation.checkpoint();
    const codePoint = value.codePointAt(cursor);
    if (codePoint === undefined) {
      break;
    }
    const width = codePoint > 0xffff ? 2 : 1;
    yield value.slice(cursor, cursor + width);
    cursor += width;
  }
}

function* iterateNormalizedSegmentScalars(
  value: string,
  preserveWhitespace: boolean,
  operation: OperationContext
): IterableIterator<string> {
  let cursor = 0;
  let inAsciiWhitespace = false;
  while (cursor < value.length) {
    operation.checkpoint();
    const codePoint = value.codePointAt(cursor);
    if (codePoint === undefined) {
      break;
    }
    const width = codePoint > 0xffff ? 2 : 1;
    const scalar = value.slice(cursor, cursor + width);
    cursor += width;

    if (preserveWhitespace) {
      if (scalar === "\r") {
        if (value[cursor] === "\n") {
          cursor += 1;
        }
        yield "\n";
      } else {
        yield scalar;
      }
      continue;
    }

    const asciiWhitespace = scalar === " " || scalar === "\t" ||
      scalar === "\n" || scalar === "\f" || scalar === "\r";
    if (asciiWhitespace) {
      if (!inAsciiWhitespace) {
        yield " ";
        inAsciiWhitespace = true;
      }
      continue;
    }
    inAsciiWhitespace = false;
    yield scalar;
  }
}

interface MutableExtractionRange {
  outputByteStart: number;
  outputByteEnd: number;
  readonly source: ExtractionSourceMeta;
}

class BoundedTextCollector {
  readonly #policy: TextExtractionPolicy;
  readonly #maxOutputBytes: number;
  readonly #maxTokens: number;
  #totalBytes = 0;
  #retainedBytes = 0;
  #retainedTokens = 0;
  #truncated = false;
  #sealed = false;
  #resultParts: string[] = [];
  #readyTokens: TextExtractionToken[] = [];
  #activeTextLogical = false;
  #activeTextAccepted = false;
  #activeTextChunks: string[] = [];
  #activeTextPendingParts: string[] = [];
  #activeTextStart = 0;
  #activeTextRanges: MutableExtractionRange[] = [];
  #pendingNewlineSource: ExtractionSourceMeta | null = null;
  #finished = false;

  constructor(policy: TextExtractionPolicy, maxOutputBytes: number, maxTokens: number) {
    this.#policy = policy;
    this.#maxOutputBytes = maxOutputBytes;
    this.#maxTokens = maxTokens;
  }

  consumeVisibleScalar(value: string, source: ExtractionSourceMeta): void {
    this.#observeScalar(value);
    if (value === "\n") {
      this.#finishTextToken();
      if (this.#pendingNewlineSource === null) {
        this.#pendingNewlineSource = source;
      } else {
        this.#emitAtomicToken("paragraphBreak", [
          { value: "\n", source: this.#pendingNewlineSource },
          { value: "\n", source }
        ]);
        this.#pendingNewlineSource = null;
      }
      return;
    }

    this.#finishPendingNewline();
    if (value === "\t") {
      this.#finishTextToken();
      this.#emitAtomicToken("tab", [{ value, source }]);
      return;
    }
    this.#appendTextScalar(value, source);
  }

  consumeRawScalar(value: string, source: ExtractionSourceMeta): void {
    this.#observeScalar(value);
    this.#appendTextScalar(value, source);
  }

  finishRawChunk(): void {
    this.#finishTextToken();
  }

  observeOmittedBytes(bytes: number): void {
    if (bytes === 0) {
      return;
    }
    this.#totalBytes += bytes;
    this.#sealed = true;
    this.#truncated = true;
  }

  takeReadyTokens(): readonly TextExtractionToken[] {
    if (this.#readyTokens.length === 0) {
      return [];
    }
    const ready = this.#readyTokens;
    this.#readyTokens = [];
    return ready;
  }

  finish(): TextExtractionResult {
    if (!this.#finished) {
      this.#finishPendingNewline();
      this.#finishTextToken();
      this.#finished = true;
    }
    return Object.freeze({
      text: this.#resultParts.join(""),
      totalBytes: this.#totalBytes,
      truncated: this.#truncated,
      policy: this.#policy
    });
  }

  #observeScalar(value: string): void {
    this.#totalBytes += scalarUtf8ByteLength(value);
  }

  #finishPendingNewline(): void {
    if (this.#pendingNewlineSource === null) {
      return;
    }
    this.#emitAtomicToken("lineBreak", [
      { value: "\n", source: this.#pendingNewlineSource }
    ]);
    this.#pendingNewlineSource = null;
  }

  #beginTextToken(): void {
    if (this.#activeTextLogical) {
      return;
    }
    this.#activeTextLogical = true;
    this.#activeTextAccepted = !this.#sealed && this.#retainedTokens < this.#maxTokens;
    this.#activeTextStart = this.#retainedBytes;
    if (!this.#activeTextAccepted) {
      this.#sealed = true;
      this.#truncated = true;
    }
  }

  #appendTextScalar(value: string, source: ExtractionSourceMeta): void {
    this.#beginTextToken();
    if (!this.#activeTextAccepted || this.#sealed) {
      return;
    }
    if (this.#appendRetainedScalar(
      value,
      source,
      this.#activeTextPendingParts,
      this.#activeTextRanges
    ) && this.#activeTextPendingParts.length >= 256) {
      this.#activeTextChunks.push(this.#activeTextPendingParts.join(""));
      this.#activeTextPendingParts = [];
    }
  }

  #appendRetainedScalar(
    value: string,
    source: ExtractionSourceMeta,
    parts: string[],
    ranges: MutableExtractionRange[]
  ): boolean {
    const bytes = scalarUtf8ByteLength(value);
    if (this.#retainedBytes + bytes > this.#maxOutputBytes) {
      this.#sealed = true;
      this.#truncated = true;
      return false;
    }
    const start = this.#retainedBytes;
    const end = start + bytes;
    parts.push(value);
    const previous = ranges[ranges.length - 1];
    if (
      previous?.outputByteEnd === start &&
      sameExtractionSource(previous.source, source)
    ) {
      previous.outputByteEnd = end;
    } else {
      ranges.push({ outputByteStart: start, outputByteEnd: end, source });
    }
    this.#retainedBytes = end;
    return true;
  }

  #finishTextToken(): void {
    if (!this.#activeTextLogical) {
      return;
    }
    if (
      this.#activeTextAccepted &&
      (this.#activeTextChunks.length > 0 || this.#activeTextPendingParts.length > 0)
    ) {
      if (this.#activeTextPendingParts.length > 0) {
        this.#activeTextChunks.push(this.#activeTextPendingParts.join(""));
      }
      this.#publishToken(
        "text",
        this.#activeTextChunks.join(""),
        this.#activeTextStart,
        this.#activeTextRanges
      );
    }
    this.#activeTextLogical = false;
    this.#activeTextAccepted = false;
    this.#activeTextChunks = [];
    this.#activeTextPendingParts = [];
    this.#activeTextRanges = [];
  }

  #emitAtomicToken(
    kind: Exclude<TextExtractionTokenKind, "text">,
    scalars: readonly { readonly value: string; readonly source: ExtractionSourceMeta }[]
  ): void {
    if (this.#sealed || this.#retainedTokens >= this.#maxTokens) {
      this.#sealed = true;
      this.#truncated = true;
      return;
    }
    const start = this.#retainedBytes;
    const parts: string[] = [];
    const ranges: MutableExtractionRange[] = [];
    for (const scalar of scalars) {
      if (!this.#appendRetainedScalar(scalar.value, scalar.source, parts, ranges)) {
        break;
      }
    }
    if (parts.length === 0) {
      return;
    }
    const value = parts.join("");
    const retainedKind = kind === "paragraphBreak" && value === "\n"
      ? "lineBreak"
      : kind;
    this.#publishToken(retainedKind, value, start, ranges);
    if (parts.length !== scalars.length) {
      this.#truncated = true;
    }
  }

  #publishToken(
    kind: TextExtractionTokenKind,
    value: string,
    outputByteStart: number,
    ranges: readonly MutableExtractionRange[]
  ): void {
    const provenance: readonly TextProvenanceRange[] = Object.freeze(
      ranges.map((range) => Object.freeze({
        outputByteStart: range.outputByteStart,
        outputByteEnd: range.outputByteEnd,
        sourceNodeId: range.source.sourceNodeId,
        sourceNodeKind: range.source.sourceNodeKind,
        sourceRole: range.source.sourceRole
      }))
    );
    const token: TextExtractionToken = Object.freeze({
      kind,
      value,
      policy: this.#policy,
      outputByteStart,
      outputByteEnd: this.#retainedBytes,
      provenance
    });
    this.#retainedTokens += 1;
    this.#resultParts.push(value);
    this.#readyTokens.push(token);
  }
}

interface PendingSourceRun {
  readonly value: string;
  readonly source: ExtractionSourceMeta;
  count: number;
}

class ExtractionSourceRunBuffer {
  readonly #maxRetainedBytes: number;
  #runs: PendingSourceRun[] = [];
  #retainedBytes = 0;
  #omittedBytes = 0;
  #lastValue: string | null = null;

  constructor(maxRetainedBytes: number) {
    this.#maxRetainedBytes = maxRetainedBytes;
  }

  get lastValue(): string | null {
    return this.#lastValue;
  }

  push(value: string, source: ExtractionSourceMeta): void {
    const bytes = scalarUtf8ByteLength(value);
    this.#lastValue = value;
    if (this.#retainedBytes + bytes > this.#maxRetainedBytes) {
      this.#omittedBytes += bytes;
      return;
    }
    const previous = this.#runs[this.#runs.length - 1];
    if (
      previous?.value === value &&
      sameExtractionSource(previous.source, source)
    ) {
      previous.count += 1;
    } else {
      this.#runs.push({ value, source, count: 1 });
    }
    this.#retainedBytes += bytes;
  }

  pushOmittedBytes(bytes: number): void {
    this.#omittedBytes += bytes;
  }

  clear(): void {
    this.#runs = [];
    this.#retainedBytes = 0;
    this.#omittedBytes = 0;
    this.#lastValue = null;
  }

  drain(
    visitor: (value: string, source: ExtractionSourceMeta) => void,
    omittedVisitor: (bytes: number) => void,
    operation: OperationContext
  ): void {
    const runs = this.#runs;
    const omittedBytes = this.#omittedBytes;
    this.clear();
    for (const run of runs) {
      for (let count = 0; count < run.count; count += 1) {
        operation.checkpoint();
        visitor(run.value, run.source);
      }
    }
    omittedVisitor(omittedBytes);
  }
}

function isEcmaTrimWhitespace(value: string): boolean {
  return /^\s$/u.test(value);
}

interface StreamingTextSink {
  emit(value: string, source: ExtractionSourceMeta): void;
  observeOmittedBytes(bytes: number): void;
}

class StreamingVisibleTextNormalizer {
  readonly #trim: boolean;
  readonly #operation: OperationContext;
  readonly #sink: StreamingTextSink;
  readonly #beforeNewline: ExtractionSourceRunBuffer;
  readonly #trailingWhitespace: ExtractionSourceRunBuffer;
  #lastGlobalValue: string | null = null;
  #newlineRun = 0;
  #seenNonWhitespace = false;

  constructor(
    trim: boolean,
    maxOutputBytes: number,
    operation: OperationContext,
    sink: StreamingTextSink
  ) {
    this.#trim = trim;
    this.#beforeNewline = new ExtractionSourceRunBuffer(maxOutputBytes);
    this.#trailingWhitespace = new ExtractionSourceRunBuffer(maxOutputBytes);
    this.#operation = operation;
    this.#sink = sink;
  }

  consume(value: string, source: ExtractionSourceMeta): void {
    this.#operation.checkpoint();
    if (value === "\n") {
      this.#beforeNewline.clear();
      this.#emitGlobal(value, source);
      return;
    }
    if (value === " " || value === "\t" || value === "\f") {
      if (this.#lastGlobalValue !== "\n") {
        const previous = this.#beforeNewline.lastValue ?? this.#lastGlobalValue;
        if ((value !== " " && value !== "\t") || previous !== value) {
          this.#beforeNewline.push(value, source);
        }
      }
      return;
    }
    this.#flushBeforeNewline();
    this.#emitGlobal(value, source);
  }

  finish(): void {
    this.#flushBeforeNewline();
    this.#trailingWhitespace.clear();
  }

  #flushBeforeNewline(): void {
    this.#beforeNewline.drain(
      (value, source) => {
        this.#emitGlobal(value, source);
      },
      (bytes) => {
        this.#emitOmittedWhitespace(bytes);
      },
      this.#operation
    );
  }

  #emitOmittedWhitespace(bytes: number): void {
    if (bytes === 0 || (this.#trim && !this.#seenNonWhitespace)) {
      return;
    }
    if (this.#trim) {
      this.#trailingWhitespace.pushOmittedBytes(bytes);
    } else {
      this.#sink.observeOmittedBytes(bytes);
    }
  }

  #emitGlobal(value: string, source: ExtractionSourceMeta): void {
    if ((value === " " || value === "\t") && this.#lastGlobalValue === value) {
      return;
    }
    if (value === "\n") {
      if (this.#newlineRun >= 2) {
        return;
      }
      this.#newlineRun += 1;
    } else {
      this.#newlineRun = 0;
    }
    this.#lastGlobalValue = value;
    this.#emitTrimmed(value, source);
  }

  #emitTrimmed(value: string, source: ExtractionSourceMeta): void {
    if (!this.#trim) {
      this.#sink.emit(value, source);
      return;
    }
    if (isEcmaTrimWhitespace(value)) {
      if (this.#seenNonWhitespace) {
        this.#trailingWhitespace.push(value, source);
      }
      return;
    }
    if (this.#seenNonWhitespace) {
      this.#trailingWhitespace.drain(
        (pendingValue, pendingSource) => {
          this.#sink.emit(pendingValue, pendingSource);
        },
        (bytes) => {
          this.#sink.observeOmittedBytes(bytes);
        },
        this.#operation
      );
    }
    this.#seenNonWhitespace = true;
    this.#sink.emit(value, source);
  }
}

function boundedNoscriptFallbackChildren(
  node: Extract<HtmlNode, { kind: "element" }>,
  options: ResolvedVisibleTextOptions
): readonly HtmlNode[] | null {
  options.operation.checkpoint();
  if (!isHtmlElement(node) || asciiLowercase(node.localName) !== "noscript") {
    return null;
  }
  if (node.children.length !== 1) {
    return null;
  }
  const onlyChild = node.children[0];
  if (onlyChild?.kind !== "text") {
    return null;
  }
  const rawMarkup = onlyChild.value;
  if (!rawMarkup.includes("<") || !rawMarkup.includes(">")) {
    return null;
  }

  const fallbackBytes = utf8ByteLength(rawMarkup, options.operation);
  enforceBudget("maxFallbackInputBytes", options.maxFallbackInputBytes, fallbackBytes);
  const remainingTimeMs = options.operation.remainingTimeMs();
  let fallbackFragment: FragmentTree;
  try {
    fallbackFragment = options.parseNestedFragment(rawMarkup, {
      namespaceUri: HTML_NAMESPACE_URI,
      localName: "body"
    }, {
      ...(options.operation.signal === undefined ? {} : { signal: options.operation.signal }),
      budgets: {
        maxNodes: options.maxFallbackNodes,
        ...(remainingTimeMs === undefined ? {} : { maxTimeMs: Math.floor(remainingTimeMs) })
      }
    });
  } catch (error) {
    if (isHtmlBudgetExceededError(error) && error.budget === "maxNodes") {
      throw new HtmlBudgetExceededError(
        "maxFallbackNodes",
        options.maxFallbackNodes,
        options.maxFallbackNodes + 1
      );
    }
    throw error;
  }
  options.operation.checkpoint();
  return fallbackFragment.children;
}

function* iterateVisibleExtractionChunks(
  roots: readonly HtmlNode[],
  options: ResolvedVisibleTextOptions
): IterableIterator<ExtractionSourceChunk> {
  interface VisitAction {
    readonly kind: "visit";
    readonly node: HtmlNode;
    readonly preserveWhitespace: boolean;
    readonly sourceOverride: ExtractionSourceMeta | null;
  }
  interface AppendAction {
    readonly kind: "append";
    readonly node: HtmlNode;
    readonly value: string;
    readonly sourceRole: TextExtractionSourceRole;
    readonly normalizeSegment: boolean;
    readonly preserveWhitespace: boolean;
    readonly sourceOverride: ExtractionSourceMeta | null;
  }
  type Action = VisitAction | AppendAction;
  const stack: Action[] = [];
  const ownership = new OwnedNodeTracker();
  const pushVisits = (
    nodes: readonly HtmlNode[],
    preserveWhitespace: boolean,
    sourceOverride: ExtractionSourceMeta | null
  ): void => {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index];
      if (node !== undefined) {
        stack.push({ kind: "visit", node, preserveWhitespace, sourceOverride });
      }
    }
  };
  const pushAppend = (
    node: HtmlNode,
    value: string,
    sourceRole: TextExtractionSourceRole,
    normalizeSegment: boolean,
    preserveWhitespace: boolean,
    sourceOverride: ExtractionSourceMeta | null
  ): void => {
    stack.push({
      kind: "append",
      node,
      value,
      sourceRole,
      normalizeSegment,
      preserveWhitespace,
      sourceOverride
    });
  };
  pushVisits(roots, false, null);

  while (stack.length > 0) {
    const action = stack.pop();
    if (action === undefined) {
      continue;
    }
    options.operation.checkpoint();
    if (action.kind === "append") {
      if (action.value.length > 0) {
        yield {
          value: action.value,
          normalizeSegment: action.normalizeSegment,
          preserveWhitespace: action.preserveWhitespace,
          source: action.sourceOverride ?? extractionSourceMetaFromNode(action.node, action.sourceRole)
        };
      }
      continue;
    }

    const { node, preserveWhitespace, sourceOverride } = action;
    ownership.observe(node);
    if (node.kind === "text") {
      pushAppend(
        node,
        node.value,
        sourceOverride?.sourceRole ?? "text-node",
        true,
        preserveWhitespace,
        sourceOverride
      );
      continue;
    }
    if (node.kind !== "element" || shouldSkipHiddenSubtree(node, options)) {
      continue;
    }
    const tagName = node.localName.toLowerCase();
    if (VISIBLE_TEXT_SKIP_TAGS.has(tagName)) {
      continue;
    }
    const fallbackChildren = boundedNoscriptFallbackChildren(node, options);
    if (fallbackChildren !== null) {
      pushVisits(fallbackChildren, preserveWhitespace, {
        sourceNodeId: node.id,
        sourceNodeKind: node.kind,
        sourceRole: "noscript-fallback"
      });
      continue;
    }
    const structuralRole = sourceOverride?.sourceRole ?? "structure-break";
    if (tagName === "br") {
      pushAppend(node, "\n", structuralRole, false, true, sourceOverride);
      continue;
    }
    if (tagName === "img" && options.includeControlValues) {
      const alt = attributeValue(node, "alt");
      if (alt && alt.length > 0) {
        pushAppend(
          node,
          alt,
          sourceOverride?.sourceRole ?? "img-alt",
          true,
          false,
          sourceOverride
        );
      }
      continue;
    }
    if (tagName === "input" && options.includeControlValues) {
      const type = (attributeValue(node, "type") ?? "text").toLowerCase();
      if (type !== "hidden") {
        const value = attributeValue(node, "value");
        if (VISIBLE_TEXT_INPUT_VALUE_TAG_TYPES.has(type) && value && value.length > 0) {
          pushAppend(
            node,
            value,
            sourceOverride?.sourceRole ?? "input-value",
            true,
            false,
            sourceOverride
          );
        } else {
          const fallbackName = accessibleNameFallback(node, options);
          if (fallbackName) {
            pushAppend(
              node,
              fallbackName,
              sourceOverride?.sourceRole ?? "input-aria-label",
              true,
              false,
              sourceOverride
            );
          }
        }
      }
      continue;
    }
    if (tagName === "select") {
      continue;
    }
    if (tagName === "button" && options.includeControlValues) {
      const value = attributeValue(node, "value");
      if (value && value.length > 0) {
        pushAppend(
          node,
          value,
          sourceOverride?.sourceRole ?? "button-value",
          true,
          false,
          sourceOverride
        );
        continue;
      }
    }
    if (tagName === "tr") {
      const actions: Action[] = [];
      actions.push({
        kind: "append",
        node,
        value: "\n",
        sourceRole: structuralRole,
        normalizeSegment: false,
        preserveWhitespace: true,
        sourceOverride
      });
      let seenTableCell = false;
      for (const child of node.children) {
        const childTagName = child.kind === "element" ? child.localName.toLowerCase() : "";
        if ((childTagName === "td" || childTagName === "th") && seenTableCell) {
          actions.push({
            kind: "append",
            node,
            value: "\t",
            sourceRole: structuralRole,
            normalizeSegment: false,
            preserveWhitespace: true,
            sourceOverride
          });
        }
        actions.push({ kind: "visit", node: child, preserveWhitespace, sourceOverride });
        if (childTagName === "td" || childTagName === "th") {
          seenTableCell = true;
        }
      }
      actions.push({
        kind: "append",
        node,
        value: "\n",
        sourceRole: structuralRole,
        normalizeSegment: false,
        preserveWhitespace: true,
        sourceOverride
      });
      for (let index = actions.length - 1; index >= 0; index -= 1) {
        const next = actions[index];
        if (next !== undefined) {
          stack.push(next);
        }
      }
      continue;
    }
    if (tagName === "td" || tagName === "th") {
      pushVisits(node.children, preserveWhitespace, sourceOverride);
      continue;
    }
    const childPreserveWhitespace = preserveWhitespace || tagName === "pre" || tagName === "textarea";
    const blockBreakBefore = tagName === "p" || VISIBLE_TEXT_BLOCK_BREAK_TAGS.has(tagName);
    if (blockBreakBefore) {
      pushAppend(
        node,
        tagName === "p" ? "\n\n" : "\n",
        structuralRole,
        false,
        true,
        sourceOverride
      );
    }
    pushVisits(node.children, childPreserveWhitespace, sourceOverride);
    if (blockBreakBefore) {
      pushAppend(node, "\n", structuralRole, false, true, sourceOverride);
    }
  }
}

function* iterateRawExtractionChunks(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  operation: OperationContext
): IterableIterator<ExtractionSourceChunk> {
  const roots = nodeOrTree.kind === "document" || nodeOrTree.kind === "fragment"
    ? nodeOrTree.children
    : [nodeOrTree];
  const stack: HtmlNode[] = [];
  const ownership = new OwnedNodeTracker();
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const root = roots[index];
    if (root !== undefined) {
      stack.push(root);
    }
  }
  while (stack.length > 0) {
    operation.checkpoint();
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    ownership.observe(node);
    if (node.kind === "text") {
      if (node.value.length > 0) {
        yield {
          value: node.value,
          normalizeSegment: false,
          preserveWhitespace: true,
          source: extractionSourceMetaFromNode(node, "text-node")
        };
      }
      continue;
    }
    if (node.kind === "templateContent") {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        if (child !== undefined) stack.push(child);
      }
    } else if (node.kind === "element") {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
}

function resolvedVisibleTextOptions(
  options: VisibleTextExtractionOptions,
  operation: OperationContext,
  parseNestedFragment: ResolvedVisibleTextOptions["parseNestedFragment"]
): ResolvedVisibleTextOptions {
  return {
    ...DEFAULT_VISIBLE_TEXT_OPTIONS,
    skipHiddenSubtrees: options.skipHiddenSubtrees ?? DEFAULT_VISIBLE_TEXT_OPTIONS.skipHiddenSubtrees,
    includeControlValues: options.includeControlValues ?? DEFAULT_VISIBLE_TEXT_OPTIONS.includeControlValues,
    includeAccessibleNameFallback:
      options.includeAccessibleNameFallback ?? DEFAULT_VISIBLE_TEXT_OPTIONS.includeAccessibleNameFallback,
    trim: options.trim ?? DEFAULT_VISIBLE_TEXT_OPTIONS.trim,
    maxFallbackInputBytes: options.maxFallbackInputBytes,
    maxFallbackNodes: options.maxFallbackNodes,
    operation,
    parseNestedFragment
  };
}

function* iterateVisibleTextInternal(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: VisibleTextExtractionOptions,
  operation: OperationContext,
  parseNestedFragment: ResolvedVisibleTextOptions["parseNestedFragment"]
): Generator<TextExtractionToken, TextExtractionResult, void> {
  const resolved = resolvedVisibleTextOptions(options, operation, parseNestedFragment);
  const collector = new BoundedTextCollector(options.policy, options.maxOutputBytes, options.maxTokens);
  const normalizer = new StreamingVisibleTextNormalizer(
    resolved.trim,
    options.maxOutputBytes,
    operation,
    {
      emit(value, source): void {
        collector.consumeVisibleScalar(value, source);
      },
      observeOmittedBytes(bytes): void {
        collector.observeOmittedBytes(bytes);
      }
    }
  );
  const roots = nodeOrTree.kind === "document" || nodeOrTree.kind === "fragment"
    ? nodeOrTree.children
    : [nodeOrTree];

  for (const chunk of iterateVisibleExtractionChunks(roots, resolved)) {
    const scalars = chunk.normalizeSegment
      ? iterateNormalizedSegmentScalars(chunk.value, chunk.preserveWhitespace, operation)
      : iterateStringScalars(chunk.value, operation);
    for (const scalar of scalars) {
      normalizer.consume(scalar, chunk.source);
      for (const token of collector.takeReadyTokens()) {
        yield token;
      }
    }
  }
  normalizer.finish();
  for (const token of collector.takeReadyTokens()) {
    yield token;
  }
  const result = collector.finish();
  for (const token of collector.takeReadyTokens()) {
    yield token;
  }
  return result;
}

function* iterateRawTextInternal(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: TextContentExtractionOptions,
  operation: OperationContext
): Generator<TextExtractionToken, TextExtractionResult, void> {
  const collector = new BoundedTextCollector(options.policy, options.maxOutputBytes, options.maxTokens);
  for (const chunk of iterateRawExtractionChunks(nodeOrTree, operation)) {
    for (const scalar of iterateStringScalars(chunk.value, operation)) {
      collector.consumeRawScalar(scalar, chunk.source);
    }
    collector.finishRawChunk();
    for (const token of collector.takeReadyTokens()) {
      yield token;
    }
  }
  const result = collector.finish();
  for (const token of collector.takeReadyTokens()) {
    yield token;
  }
  return result;
}

function iterateTextUsing(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: TextExtractionOptions,
  parseNestedFragment: ResolvedVisibleTextOptions["parseNestedFragment"]
): Generator<TextExtractionToken, TextExtractionResult, void> {
  const startedAt = performance.now();
  const normalizedOptions = normalizeTextExtractionOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  return normalizedOptions.policy === VISIBLE_TEXT_HTML_POLICY
    ? iterateVisibleTextInternal(nodeOrTree, normalizedOptions, operation, parseNestedFragment)
    : iterateRawTextInternal(nodeOrTree, normalizedOptions, operation);
}

/**
 * Creates the text operations for one explicit nested-markup parser.
 *
 * This integration seam is intentionally absent from the package root. It
 * keeps nested `noscript` work on the same parser route as the owning tree
 * without a global selector or tree-origin registry.
 */
function createTextOperations(
  parseNestedFragment: ResolvedVisibleTextOptions["parseNestedFragment"]
): Readonly<{
  iterateText(
    nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
    options: TextExtractionOptions
  ): Generator<TextExtractionToken, TextExtractionResult, void>;
  extractText(
    nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
    options: TextExtractionOptions
  ): TextExtractionResult;
}> {
  const iterate = (
    nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
    options: TextExtractionOptions
  ): Generator<TextExtractionToken, TextExtractionResult, void> =>
    iterateTextUsing(nodeOrTree, options, parseNestedFragment);
  return Object.freeze({
    iterateText: iterate,
    extractText(
      nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
      options: TextExtractionOptions
    ): TextExtractionResult {
      const iterator = iterate(nodeOrTree, options);
      let next = iterator.next();
      while (!next.done) {
        next = iterator.next();
      }
      return next.value;
    }
  });
}

const textOperations = createTextOperations((html, context, options) =>
  parseFragment(html, context, options).tree);

/**
 * Iterates bounded policy tokens and returns the final result when fully drained.
 *
 * @example
 * ```ts
 * import { iterateText, parse } from "jsr:@ismail-elkorchi/html-parser";
 *
 * const document = parse("<p>Hello world</p>");
 * const iterator = iterateText(document.tree, {
 *   policy: "text-content-v1",
 *   maxOutputBytes: 128,
 *   maxTokens: 16
 * });
 * for (let next = iterator.next(); !next.done; next = iterator.next()) {
 *   console.log(next.value.value);
 * }
 * ```
 */
export function iterateText(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: TextExtractionOptions
): Generator<TextExtractionToken, TextExtractionResult, void> {
  return textOperations.iterateText(nodeOrTree, options);
}

/**
 * Extracts bounded text under an explicit, versioned semantic policy.
 *
 * @example
 * ```ts
 * import { extractText, parse } from "jsr:@ismail-elkorchi/html-parser";
 *
 * const document = parse("<main>Hello <b>world</b></main>");
 * const result = extractText(document.tree, {
 *   policy: "text-content-v1",
 *   maxOutputBytes: 128,
 *   maxTokens: 16
 * });
 * console.log(result.text);
 * ```
 */
export function extractText(
  nodeOrTree: DocumentTree | FragmentTree | HtmlNode,
  options: TextExtractionOptions
): TextExtractionResult {
  return textOperations.extractText(nodeOrTree, options);
}
