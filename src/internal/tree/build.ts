import {
  defaultTreeAdapter,
  parse,
  parseFragment,
  type Parse5TokenDetails
} from "../parse5-runtime.js";

import type {
  TreeAttribute,
  TreeBudgets,
  TreeBuildOptions,
  TreeBuildResult,
  TreeBuilderError,
  TreeNode,
  TreeNodeComment,
  TreeNodeDoctype,
  TreeNodeElement,
  TreeNodeText,
  TreeSpan,
  TreeTokenKind
} from "./types.js";
import type { HtmlToken } from "../tokenizer/tokens.js";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";

const CONTEXT_DOCUMENT_HTML =
  "<!doctype html><html><head><title>x</title></head><body><table><tbody><tr><td></td></tr><caption></caption><colgroup></colgroup></table><frameset></frameset></body></html>";
const CONTEXT_DOCUMENT_FRAMESET =
  "<!doctype html><html><frameset></frameset></html>";

type Parse5Attribute = {
  readonly name: string;
  readonly value: string;
  readonly prefix?: string;
};

interface Parse5NodeBase {
  readonly nodeName: string;
  parentNode?: Parse5ParentNode | null;
  readonly sourceCodeLocation?: unknown;
}

interface Parse5ParentNode extends Parse5NodeBase {
  childNodes: Parse5ChildNode[];
}

interface Parse5Document extends Parse5ParentNode {
  readonly nodeName: "#document";
}

interface Parse5DocumentFragment extends Parse5ParentNode {
  readonly nodeName: "#document-fragment";
}

interface Parse5Element extends Parse5ParentNode {
  readonly tagName: string;
  readonly namespaceURI: string;
  attrs: Parse5Attribute[];
}

interface Parse5TextNode extends Parse5NodeBase {
  readonly nodeName: "#text";
  value: string;
}

interface Parse5CommentNode extends Parse5NodeBase {
  readonly nodeName: "#comment";
  readonly data: string;
}

interface Parse5DocumentType extends Parse5NodeBase {
  readonly nodeName: "#documentType";
  readonly name: string;
  readonly publicId?: string | null;
  readonly systemId?: string | null;
}

type Parse5ChildNode =
  | Parse5TextNode
  | Parse5CommentNode
  | Parse5DocumentType
  | Parse5Element;

type Parse5AnyNode = Parse5Document | Parse5DocumentFragment | Parse5ChildNode;

interface Parse5TreeAdapter {
  createDocument(): Parse5Document;
  createDocumentFragment(): Parse5DocumentFragment;
  createElement(tagName: string, namespaceURI: string, attrs: Parse5Attribute[]): Parse5Element;
  createCommentNode(data: string): Parse5CommentNode;
  createTextNode(value: string): Parse5TextNode;
  appendChild(parentNode: Parse5ParentNode, newNode: Parse5ChildNode): void;
  insertBefore(parentNode: Parse5ParentNode, newNode: Parse5ChildNode, referenceNode: Parse5ChildNode): void;
  setTemplateContent(templateElement: Parse5Element, contentElement: Parse5DocumentFragment): void;
  getTemplateContent(templateElement: Parse5Element): Parse5DocumentFragment;
  setDocumentType(document: Parse5Document, name: string, publicId: string, systemId: string): void;
  detachNode(node: Parse5ChildNode): void;
  insertText(parentNode: Parse5ParentNode, text: string): void;
  insertTextBefore(parentNode: Parse5ParentNode, text: string, referenceNode: Parse5ChildNode): void;
  adoptAttributes(recipient: Parse5Element, attrs: Parse5Attribute[]): void;
  getFirstChild(node: Parse5ParentNode): Parse5ChildNode | undefined;
  getChildNodes(node: Parse5ParentNode): Parse5ChildNode[];
  getParentNode(node: Parse5AnyNode): Parse5ParentNode | null | undefined;
  getAttrList(element: Parse5Element): Parse5Attribute[];
  isTextNode(node: Parse5AnyNode): node is Parse5TextNode;
  isDocumentTypeNode(node: Parse5AnyNode): node is Parse5DocumentType;
  readonly [key: PropertyKey]: unknown;
}

interface SourceLocationLike {
  readonly startOffset?: number;
  readonly endOffset?: number;
  readonly attrs?: Readonly<Record<string, SourceLocationLike | undefined>>;
  readonly startTag?: SourceLocationLike;
}

interface BuildState {
  readonly captureSpans: boolean;
  readonly checkpoint: (() => void) | undefined;
}

export type TreeBudgetName =
  | "maxNodes"
  | "maxDepth"
  | "maxParseErrors"
  | "maxAttributesPerElement"
  | "maxAttributeBytes";

/** Internal hard-stop signal mapped to the public budget error at the package boundary. */
export class TreeBudgetExceededError extends Error {
  readonly budget: TreeBudgetName;
  readonly limit: number;
  readonly actual: number;

  constructor(budget: TreeBudgetName, limit: number, actual: number) {
    super(`Tree budget exceeded: ${budget} limit=${String(limit)} actual=${String(actual)}`);
    this.name = "TreeBudgetExceededError";
    this.budget = budget;
    this.limit = limit;
    this.actual = actual;
  }
}

class TreeBudgetController {
  readonly adapter: Parse5TreeAdapter;
  readonly #budgets: TreeBudgets | undefined;
  readonly #checkpoint: (() => void) | undefined;
  readonly #fragment: boolean;
  readonly #depths = new WeakMap<object, number>();
  readonly #templateContents = new WeakMap<object, Parse5DocumentFragment>();
  readonly #encoder = new TextEncoder();
  #nodeCount: number;
  #parseErrorCount = 0;
  #currentStartTagAttributeCount = 0;
  #currentStartTagAttributeBytes = 0;
  #afterEof = false;
  #fragmentDocumentMockSeen = false;
  #fragmentFakeRootSeen = false;

  constructor(budgets: TreeBudgets | undefined, checkpoint: (() => void) | undefined, fragment: boolean) {
    this.#budgets = budgets;
    this.#checkpoint = checkpoint;
    this.#fragment = fragment;
    this.#nodeCount = fragment ? 1 : 0;
    if (fragment) {
      this.#enforce("maxNodes", this.#nodeCount);
      this.#enforce("maxDepth", 1);
    }
    this.adapter = this.#createAdapter();
  }

  checkpoint(): void {
    this.#checkpoint?.();
  }

  markEof(): void {
    this.#afterEof = true;
  }

  recordParseError(): void {
    this.checkpoint();
    this.#parseErrorCount += 1;
    this.#enforce("maxParseErrors", this.#parseErrorCount);
  }

  startTag(): void {
    this.checkpoint();
    this.#currentStartTagAttributeCount = 0;
    this.#currentStartTagAttributeBytes = 0;
  }

  appendStartTagAttribute(value: string, start: boolean): void {
    this.checkpoint();
    if (start) {
      this.#currentStartTagAttributeCount += 1;
      this.#enforce("maxAttributesPerElement", this.#currentStartTagAttributeCount);
    }
    this.#currentStartTagAttributeBytes += this.#encoder.encode(value).byteLength;
    this.#enforce("maxAttributeBytes", this.#currentStartTagAttributeBytes);
  }

  createRecoveryElement(tagName: string, namespaceURI: string): Parse5Element {
    return this.adapter.createElement(tagName, namespaceURI, []);
  }

  recheckSubtreeDepth(root: Parse5AnyNode): void {
    this.#assignSubtreeDepth(root, this.#depths.get(root) ?? 1);
  }

  checkAttributes(attrs: readonly Parse5Attribute[]): void {
    this.checkpoint();
    const maxAttributes = this.#budgets?.maxAttributesPerElement;
    if (maxAttributes !== undefined && attrs.length > maxAttributes) {
      throw new TreeBudgetExceededError(
        "maxAttributesPerElement",
        maxAttributes,
        maxAttributes + 1
      );
    }

    const maxBytes = this.#budgets?.maxAttributeBytes;
    if (maxBytes === undefined) {
      return;
    }
    let bytes = 0;
    for (const attribute of attrs) {
      bytes += this.#encoder.encode(attribute.name).byteLength;
      bytes += this.#encoder.encode(attribute.value).byteLength;
      if (bytes > maxBytes) {
        throw new TreeBudgetExceededError("maxAttributeBytes", maxBytes, maxBytes + 1);
      }
    }
  }

  #enforce(budget: TreeBudgetName, actual: number): void {
    this.checkpoint();
    const limit = this.#budgets?.[budget];
    if (limit !== undefined && actual > limit) {
      throw new TreeBudgetExceededError(budget, limit, limit + 1);
    }
  }

  #countNode(): void {
    this.#nodeCount += 1;
    this.#enforce("maxNodes", this.#nodeCount);
  }

  #isFragmentInfrastructureElement(tagName: string): boolean {
    if (!this.#fragment || this.#afterEof) {
      return false;
    }
    if (!this.#fragmentDocumentMockSeen && tagName === "documentmock") {
      this.#fragmentDocumentMockSeen = true;
      return true;
    }
    if (this.#fragmentDocumentMockSeen && !this.#fragmentFakeRootSeen && tagName === "html") {
      this.#fragmentFakeRootSeen = true;
      return true;
    }
    return false;
  }

  #assignSubtreeDepth(root: Parse5AnyNode, rootDepth: number): void {
    const stack: { readonly node: Parse5AnyNode; readonly depth: number }[] = [
      { node: root, depth: rootDepth }
    ];
    while (stack.length > 0) {
      const entry = stack.pop();
      if (!entry) {
        continue;
      }
      this.#depths.set(entry.node, entry.depth);
      this.#enforce("maxDepth", entry.depth);
      if ("childNodes" in entry.node) {
        for (let index = entry.node.childNodes.length - 1; index >= 0; index -= 1) {
          const child = entry.node.childNodes[index];
          if (child) {
            stack.push({ node: child, depth: entry.depth + 1 });
          }
        }
      }
      const templateContent = this.#templateContents.get(entry.node);
      if (templateContent) {
        stack.push({ node: templateContent, depth: entry.depth + 1 });
      }
    }
  }

  #createAdapter(): Parse5TreeAdapter {
    const base = defaultTreeAdapter as Parse5TreeAdapter;
    const depths = this.#depths;
    const templateContents = this.#templateContents;
    const countNode = (): void => {
      this.#countNode();
    };
    const enforceDepth = (depth: number): void => {
      this.#enforce("maxDepth", depth);
    };
    const isFinalFragmentRoot = (): boolean => this.#fragment && this.#afterEof;
    const isFragmentInfrastructureElement = (tagName: string): boolean =>
      this.#isFragmentInfrastructureElement(tagName);
    const checkAttributes = (attrs: readonly Parse5Attribute[]): void => {
      this.checkAttributes(attrs);
    };
    const assignSubtreeDepth = (node: Parse5AnyNode, depth: number): void => {
      this.#assignSubtreeDepth(node, depth);
    };
    const adapter: Parse5TreeAdapter = {
      ...base,
      createDocument(): Parse5Document {
        countNode();
        const document = base.createDocument();
        depths.set(document, 1);
        enforceDepth(1);
        return document;
      },
      createDocumentFragment(): Parse5DocumentFragment {
        const isFinalRoot = isFinalFragmentRoot();
        if (!isFinalRoot) {
          countNode();
        }
        const fragment = base.createDocumentFragment();
        if (isFinalRoot) {
          depths.set(fragment, 1);
        }
        return fragment;
      },
      createElement(tagName: string, namespaceURI: string, attrs: Parse5Attribute[]): Parse5Element {
        checkAttributes(attrs);
        const infrastructure = isFragmentInfrastructureElement(tagName);
        if (!infrastructure) {
          countNode();
        }
        const element = base.createElement(tagName, namespaceURI, attrs);
        if (infrastructure) {
          depths.set(element, tagName === "documentmock" ? 0 : 1);
        }
        return element;
      },
      createCommentNode(data: string): Parse5CommentNode {
        countNode();
        return base.createCommentNode(data);
      },
      createTextNode(value: string): Parse5TextNode {
        countNode();
        return base.createTextNode(value);
      },
      appendChild(parentNode: Parse5ParentNode, newNode: Parse5ChildNode): void {
        base.appendChild(parentNode, newNode);
        const parentDepth = depths.get(parentNode) ?? 1;
        assignSubtreeDepth(newNode, parentDepth + 1);
      },
      insertBefore(
        parentNode: Parse5ParentNode,
        newNode: Parse5ChildNode,
        referenceNode: Parse5ChildNode
      ): void {
        base.insertBefore(parentNode, newNode, referenceNode);
        const parentDepth = depths.get(parentNode) ?? 1;
        assignSubtreeDepth(newNode, parentDepth + 1);
      },
      setTemplateContent(templateElement: Parse5Element, contentElement: Parse5DocumentFragment): void {
        base.setTemplateContent(templateElement, contentElement);
        templateContents.set(templateElement, contentElement);
        const templateDepth = depths.get(templateElement);
        if (templateDepth !== undefined) {
          assignSubtreeDepth(contentElement, templateDepth + 1);
        }
      },
      setDocumentType(document: Parse5Document, name: string, publicId: string, systemId: string): void {
        const existing = base.getChildNodes(document).find((node) => base.isDocumentTypeNode(node));
        if (!existing) {
          countNode();
        }
        base.setDocumentType(document, name, publicId, systemId);
        const doctype = base.getChildNodes(document).find((node) => base.isDocumentTypeNode(node));
        if (doctype) {
          const documentDepth = depths.get(document) ?? 1;
          assignSubtreeDepth(doctype, documentDepth + 1);
        }
      },
      insertText(parentNode: Parse5ParentNode, text: string): void {
        const children = base.getChildNodes(parentNode);
        const previous = children[children.length - 1];
        if (previous && base.isTextNode(previous)) {
          previous.value += text;
          return;
        }
        adapter.appendChild(parentNode, adapter.createTextNode(text));
      },
      insertTextBefore(parentNode: Parse5ParentNode, text: string, referenceNode: Parse5ChildNode): void {
        const children = base.getChildNodes(parentNode);
        const previous = children[children.indexOf(referenceNode) - 1];
        if (previous && base.isTextNode(previous)) {
          previous.value += text;
          return;
        }
        adapter.insertBefore(parentNode, adapter.createTextNode(text), referenceNode);
      },
      adoptAttributes(recipient: Parse5Element, attrs: Parse5Attribute[]): void {
        const existingNames = new Set(base.getAttrList(recipient).map((attribute) => attribute.name));
        const combined = [
          ...base.getAttrList(recipient),
          ...attrs.filter((attribute) => !existingNames.has(attribute.name))
        ];
        checkAttributes(combined);
        base.adoptAttributes(recipient, attrs);
      }
    };
    return adapter;
  }
}

function pushParseError(
  errors: TreeBuilderError[],
  error: {
    readonly code: string;
    readonly startOffset?: number;
    readonly endOffset?: number;
  }
): TreeBuilderError {
  const startOffset = typeof error.startOffset === "number" ? error.startOffset : 0;
  const next: TreeBuilderError = {
    code: error.code,
    tokenIndex: startOffset,
    ...(typeof error.startOffset === "number" ? { startOffset: error.startOffset } : {}),
    ...(typeof error.endOffset === "number" ? { endOffset: error.endOffset } : {})
  };
  errors.push(next);
  return next;
}

function formatElementName(namespaceURI: string, tagName: string): string {
  if (namespaceURI === HTML_NAMESPACE) {
    return tagName;
  }

  if (namespaceURI === SVG_NAMESPACE) {
    return `svg ${tagName}`;
  }

  if (namespaceURI === MATHML_NAMESPACE) {
    return `math ${tagName}`;
  }

  return `${namespaceURI} ${tagName}`;
}

function formatAttributeName(attribute: Parse5Attribute): string {
  if (attribute.prefix !== undefined && attribute.prefix.length > 0 && attribute.name.includes(":")) {
    const localName = attribute.name.slice(attribute.prefix.length + 1);
    return `${attribute.prefix} ${localName}`;
  }

  return attribute.name;
}

function asSourceLocation(value: unknown): SourceLocationLike | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const startOffset = candidate["startOffset"];
  const endOffset = candidate["endOffset"];

  if (typeof startOffset !== "number" || typeof endOffset !== "number") {
    return undefined;
  }

  return candidate;
}

function toTreeSpan(location: SourceLocationLike | undefined): TreeSpan | undefined {
  if (!location) {
    return undefined;
  }

  if (
    typeof location.startOffset !== "number" ||
    typeof location.endOffset !== "number" ||
    location.startOffset < 0 ||
    location.endOffset < location.startOffset
  ) {
    return undefined;
  }

  return Object.freeze({
    start: location.startOffset,
    end: location.endOffset
  });
}

function toElementTreeSpan(location: SourceLocationLike | undefined): TreeSpan | undefined {
  return toTreeSpan(location) ?? toTreeSpan(location?.startTag);
}

function normalizeAttributes(
  attrs: readonly Parse5Attribute[],
  state: BuildState,
  sourceLocation: SourceLocationLike | undefined
): readonly TreeAttribute[] {
  const normalized: TreeAttribute[] = [];
  const seen = new Set<string>();

  for (const attr of attrs) {
    state.checkpoint?.();
    const name = formatAttributeName(attr);

    if (seen.has(name)) {
      continue;
    }

    seen.add(name);
    const rawLocation = sourceLocation?.attrs?.[attr.name] ?? sourceLocation?.attrs?.[name];
    const span = state.captureSpans ? toTreeSpan(rawLocation) : undefined;

    normalized.push(
      Object.freeze({
        name,
        value: attr.value,
        ...(span ? { span } : {})
      })
    );
  }

  return Object.freeze(normalized);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hasChildNodes(node: Parse5ChildNode): node is Parse5Element {
  return node.nodeName !== "#text" && node.nodeName !== "#comment" && node.nodeName !== "#documentType";
}

function isTextNode(node: Parse5ChildNode): node is Parse5TextNode {
  return node.nodeName === "#text";
}

function isCommentNode(node: Parse5ChildNode): node is Parse5CommentNode {
  return node.nodeName === "#comment";
}

function isDocumentTypeNode(node: Parse5ChildNode): node is Parse5DocumentType {
  return node.nodeName === "#documentType";
}

function isElementNode(node: Parse5ChildNode): node is Parse5Element {
  return hasChildNodes(node);
}

function isElement(node: Parse5ChildNode, tagName: string): node is Parse5Element {
  return node.nodeName === tagName;
}

function findElementByTagName(node: Parse5ParentNode, tagName: string): Parse5Element | null {
  for (const child of node.childNodes) {
    if (isElement(child, tagName)) {
      return child;
    }

    if (hasChildNodes(child)) {
      const nested = findElementByTagName(child, tagName);
      if (nested !== null) {
        return nested;
      }
    }
  }

  return null;
}

function createFragmentContext(fragmentContextTagName: string): Parse5Element | null {
  const tagName = fragmentContextTagName.trim().toLowerCase();
  if (tagName.length === 0) {
    return null;
  }

  if (tagName === "frameset") {
    return findElementByTagName(parse(CONTEXT_DOCUMENT_FRAMESET) as Parse5Document, tagName);
  }

  if (tagName === "html" || tagName === "head" || tagName === "body" || tagName === "title") {
    return findElementByTagName(parse(CONTEXT_DOCUMENT_HTML) as Parse5Document, tagName);
  }

  const contextFragment = parseFragment(`<${tagName}></${tagName}>`) as Parse5DocumentFragment;
  for (const child of contextFragment.childNodes) {
    if (isElement(child, tagName)) {
      return child;
    }
  }

  return null;
}

function patchSelectAdoptionCompatibility(
  root: Parse5Document | Parse5DocumentFragment,
  controller: TreeBudgetController
): void {
  const walk = (node: Parse5ParentNode): void => {
    controller.checkpoint();
    for (const child of node.childNodes) {
      if ("childNodes" in child) {
        walk(child);
      }
    }

    if (node.nodeName !== "body") {
      return;
    }

    for (let index = 0; index < node.childNodes.length - 1; index += 1) {
      const left = node.childNodes[index];
      const right = node.childNodes[index + 1];
      if (left === undefined || right === undefined) {
        continue;
      }

      if (!isElement(left, "select") || !isElement(right, "option")) {
        continue;
      }

      if (left.attrs.length > 0 || right.attrs.length > 0) {
        continue;
      }

      const selectChild = left.childNodes[0];
      if (selectChild === undefined || !isElement(selectChild, "option")) {
        continue;
      }

      if (left.childNodes.length !== 1 || selectChild.attrs.length > 0) {
        continue;
      }

      const leftWrapper = controller.createRecoveryElement("b", left.namespaceURI);

      selectChild.parentNode = leftWrapper;
      leftWrapper.parentNode = left;
      leftWrapper.childNodes = [selectChild];
      left.childNodes = [leftWrapper];

      const detachedTextNodes = right.childNodes.filter((child) => child.nodeName === "#text");
      right.childNodes = right.childNodes.filter((child) => child.nodeName !== "#text");

      const rightWrapper = controller.createRecoveryElement("b", right.namespaceURI);

      rightWrapper.parentNode = node;
      rightWrapper.childNodes = [right];
      right.parentNode = rightWrapper;
      node.childNodes[index + 1] = rightWrapper;

      if (detachedTextNodes.length > 0) {
        for (const textNode of detachedTextNodes) {
          textNode.parentNode = node;
        }

        node.childNodes.splice(index + 2, 0, ...detachedTextNodes);
      }
    }
  };

  walk(root);
  controller.recheckSubtreeDepth(root);
}

function parseTree(
  input: string,
  budgets: TreeBudgets | undefined,
  options: TreeBuildOptions,
  errors: TreeBuilderError[]
): Parse5Document | Parse5DocumentFragment {
  const controller = new TreeBudgetController(
    budgets,
    options.checkpoint,
    options.fragmentContextTagName !== undefined
  );
  const parseOptions = {
    scriptingEnabled: options.scriptingEnabled ?? true,
    sourceCodeLocationInfo: options.captureSpans ?? false,
    treeAdapter: controller.adapter,
    onProgress(): void {
      controller.checkpoint();
    },
    onParseError(error: { readonly code: string; readonly startOffset?: number; readonly endOffset?: number }): void {
      controller.recordParseError();
      const normalized = pushParseError(errors, error);
      options.onParseError?.(normalized);
    }
  };

  Object.assign(parseOptions, {
    onStartTagOpen(): void {
      controller.startTag();
    },
    onStartTagAttribute(value: string, start: boolean): void {
      controller.appendStartTagAttribute(value, start);
    },
    onToken(kind: TreeTokenKind, token: Parse5TokenDetails): void {
      controller.checkpoint();
      const attrs = token.attrs;
      if (kind === "startTag" && attrs) {
        controller.checkAttributes(attrs);
      }
      if (kind === "eof") {
        controller.markEof();
      }
      options.onToken?.(kind, {
        ...(attrs ? { attributes: attrs } : {})
      });
    }
  });

  if (options.onInsertionModeTransition) {
    Object.assign(parseOptions, {
      onInsertionModeTransition(transition: {
        readonly fromMode: string;
        readonly toMode: string;
        readonly tokenType: string | null;
        readonly tokenTagName: string | null;
        readonly tokenStartOffset: number | null;
        readonly tokenEndOffset: number | null;
      }): void {
        options.onInsertionModeTransition?.(transition);
      }
    });
  }

  let parsed: Parse5Document | Parse5DocumentFragment;
  if (options.fragmentContextTagName !== undefined) {
    const context = createFragmentContext(options.fragmentContextTagName);
    parsed = parseFragment(context, input, parseOptions) as Parse5DocumentFragment;
  } else {
    parsed = parse(input, parseOptions) as Parse5Document;
  }
  patchSelectAdoptionCompatibility(parsed, controller);
  return parsed;
}

function convertNode(node: Parse5ChildNode, depth: number, state: BuildState): TreeNode | null {
  state.checkpoint?.();
  const sourceLocation = state.captureSpans ? asSourceLocation(node.sourceCodeLocation) : undefined;
  const nodeSpan = toTreeSpan(sourceLocation);

  if (isTextNode(node)) {
    const textNode: TreeNodeText = {
      kind: "text",
      value: readString(node.value),
      ...(nodeSpan ? { span: nodeSpan } : {})
    };

    return textNode;
  }

  if (isCommentNode(node)) {
    const commentNode: TreeNodeComment = {
      kind: "comment",
      value: readString(node.data),
      ...(nodeSpan ? { span: nodeSpan } : {})
    };

    return commentNode;
  }

  if (isDocumentTypeNode(node)) {
    const doctypeNode: TreeNodeDoctype = {
      kind: "doctype",
      name: readString(node.name),
      publicId: readString(node.publicId),
      systemId: readString(node.systemId),
      ...(nodeSpan ? { span: nodeSpan } : {})
    };

    return doctypeNode;
  }

  if (!isElementNode(node)) {
    return null;
  }

  const children: TreeNode[] = [];
  for (const child of node.childNodes) {
    const converted = convertNode(child, depth + 1, state);
    if (converted !== null) {
      children.push(converted);
    }
  }

  const elementSpan = toElementTreeSpan(sourceLocation);
  const elementNode: TreeNodeElement = {
    kind: "element",
    name: formatElementName(node.namespaceURI, node.tagName),
    attributes: normalizeAttributes(node.attrs, state, sourceLocation),
    children,
    ...(elementSpan ? { span: elementSpan } : {})
  };

  return elementNode;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeTextForReparse(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function serializeTokens(tokens: readonly HtmlToken[]): string {
  const parts: string[] = [];

  for (const token of tokens) {
    if (token.type === "EOF") {
      continue;
    }

    if (token.type === "StartTag") {
      const attributes = Object.entries(token.attributes)
        .map(([name, value]) => `${name}="${escapeAttributeValue(value)}"`)
        .join(" ");

      const start = attributes.length > 0 ? `<${token.name} ${attributes}` : `<${token.name}`;
      parts.push(token.selfClosing ? `${start}/>` : `${start}>`);
      continue;
    }

    if (token.type === "EndTag") {
      parts.push(`</${token.name}>`);
      continue;
    }

    if (token.type === "Character") {
      parts.push(escapeTextForReparse(token.data));
      continue;
    }

    if (token.type === "Comment") {
      parts.push(`<!--${token.data}-->`);
      continue;
    }

    if (token.publicId !== null || token.systemId !== null) {
      const publicId = token.publicId ?? "";
      const systemId = token.systemId ?? "";
      parts.push(`<!DOCTYPE ${token.name} "${publicId}" "${systemId}">`);
      continue;
    }

    parts.push(`<!DOCTYPE ${token.name}>`);
  }

  return parts.join("");
}

export function buildTreeFromHtml(
  input: string,
  budgets?: TreeBudgets,
  options: TreeBuildOptions = {}
): TreeBuildResult {
  const errors: TreeBuilderError[] = [];
  const parsed = parseTree(input, budgets, options, errors);

  const state: BuildState = {
    captureSpans: options.captureSpans ?? false,
    checkpoint: options.checkpoint
  };

  const children: TreeNode[] = [];
  for (const child of parsed.childNodes) {
    const converted = convertNode(child, 0, state);
    if (converted !== null) {
      children.push(converted);
    }
  }

  return {
    document: {
      kind: "document",
      children
    },
    errors
  };
}

export function buildTreeFromTokens(tokens: readonly HtmlToken[], budgets?: TreeBudgets): TreeBuildResult {
  const html = serializeTokens(tokens);
  return buildTreeFromHtml(html, budgets);
}
