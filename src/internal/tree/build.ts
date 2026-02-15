import { parse, parseFragment, type DefaultTreeAdapterTypes } from "parse5";

import type {
  TreeBudgets,
  TreeBuildOptions,
  TreeBuildResult,
  TreeBuilderError,
  TreeNode,
  TreeNodeComment,
  TreeNodeDoctype,
  TreeNodeElement,
  TreeNodeText
} from "./types.js";
import type { HtmlToken } from "../tokenizer/tokens.js";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";

const CONTEXT_DOCUMENT_HTML =
  "<!doctype html><html><head><title>x</title></head><body><table><tbody><tr><td></td></tr><caption></caption><colgroup></colgroup></table><frameset></frameset></body></html>";

type Parse5Document = DefaultTreeAdapterTypes.Document;
type Parse5DocumentFragment = DefaultTreeAdapterTypes.DocumentFragment;
type Parse5ParentNode = DefaultTreeAdapterTypes.ParentNode;
type Parse5ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Parse5Element = DefaultTreeAdapterTypes.Element;
type Parse5Template = DefaultTreeAdapterTypes.Template;
type Parse5TextNode = DefaultTreeAdapterTypes.TextNode;
type Parse5CommentNode = DefaultTreeAdapterTypes.CommentNode;
type Parse5DocumentType = DefaultTreeAdapterTypes.DocumentType;
type Parse5Attribute = {
  readonly name: string;
  readonly value: string;
  readonly prefix?: string;
};

interface BuildState {
  readonly budgets: TreeBudgets | undefined;
  readonly errors: TreeBuilderError[];
  nodeCount: number;
}

function pushError(errors: TreeBuilderError[], code: string, tokenIndex = 0): void {
  errors.push({ code, tokenIndex });
}

function enforceTreeBudgets(depth: number, state: BuildState, tokenIndex: number): void {
  const maxDepth = state.budgets?.maxDepth;
  if (maxDepth !== undefined && depth > maxDepth) {
    pushError(state.errors, "max-depth-exceeded", tokenIndex);
  }

  const maxNodes = state.budgets?.maxNodes;
  if (maxNodes !== undefined && state.nodeCount > maxNodes) {
    pushError(state.errors, "max-nodes-exceeded", tokenIndex);
  }
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

function normalizeAttributes(
  attrs: readonly Parse5Attribute[],
  state: BuildState,
  tokenIndex: number
): Readonly<Record<string, string>> {
  const maxAttributesPerElement = state.budgets?.maxAttributesPerElement;
  if (maxAttributesPerElement !== undefined && attrs.length > maxAttributesPerElement) {
    pushError(state.errors, "max-attributes-per-element-exceeded", tokenIndex);
  }

  const record: Record<string, string> = {};
  let totalAttributeBytes = 0;

  for (const attr of attrs) {
    const name = formatAttributeName(attr);
    totalAttributeBytes += name.length + attr.value.length;

    if (record[name] === undefined) {
      record[name] = attr.value;
    }
  }

  const maxAttributeBytes = state.budgets?.maxAttributeBytes;
  if (maxAttributeBytes !== undefined && totalAttributeBytes > maxAttributeBytes) {
    pushError(state.errors, "max-attribute-bytes-exceeded", tokenIndex);
  }

  return Object.freeze(record);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hasChildNodes(node: Parse5ChildNode): node is Parse5Element | Parse5Template {
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

function isElementNode(node: Parse5ChildNode): node is Parse5Element | Parse5Template {
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

  if (tagName === "html" || tagName === "head" || tagName === "body" || tagName === "title") {
    return findElementByTagName(parse(CONTEXT_DOCUMENT_HTML), tagName);
  }

  const contextFragment = parseFragment(`<${tagName}></${tagName}>`);
  for (const child of contextFragment.childNodes) {
    if (isElement(child, tagName)) {
      return child;
    }
  }

  return null;
}

function patchSelectAdoptionCompatibility(root: Parse5Document | Parse5DocumentFragment): void {
  const walk = (node: Parse5ParentNode): void => {
    for (const child of node.childNodes) {
      if ("childNodes" in child) {
        walk(child as Parse5ParentNode);
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

      const leftWrapper: Parse5Element = {
        nodeName: "b",
        tagName: "b",
        attrs: [],
        namespaceURI: left.namespaceURI,
        parentNode: left,
        childNodes: [selectChild]
      };

      selectChild.parentNode = leftWrapper;
      left.childNodes = [leftWrapper];

      const detachedTextNodes = right.childNodes.filter((child) => child.nodeName === "#text");
      right.childNodes = right.childNodes.filter((child) => child.nodeName !== "#text");

      const rightWrapper: Parse5Element = {
        nodeName: "b",
        tagName: "b",
        attrs: [],
        namespaceURI: right.namespaceURI,
        parentNode: node,
        childNodes: [right]
      };

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

  walk(root as Parse5ParentNode);
}

function parseTree(
  input: string,
  options: TreeBuildOptions,
  errors: TreeBuilderError[]
): Parse5Document | Parse5DocumentFragment {
  const parseOptions = {
    scriptingEnabled: options.scriptingEnabled ?? true,
    onParseError(error: { readonly code: string; readonly startOffset: number }): void {
      pushError(errors, error.code, error.startOffset);
    }
  };

  if (options.fragmentContextTagName !== undefined) {
    const context = createFragmentContext(options.fragmentContextTagName);
    return parseFragment(context, input, parseOptions);
  }

  return parse(input, parseOptions);
}

function convertNode(node: Parse5ChildNode, depth: number, state: BuildState): TreeNode | null {
  if (isTextNode(node)) {
    state.nodeCount += 1;
    enforceTreeBudgets(depth, state, 0);

    const textNode: TreeNodeText = {
      kind: "text",
      value: readString(node.value)
    };

    return textNode;
  }

  if (isCommentNode(node)) {
    state.nodeCount += 1;
    enforceTreeBudgets(depth, state, 0);

    const commentNode: TreeNodeComment = {
      kind: "comment",
      value: readString(node.data)
    };

    return commentNode;
  }

  if (isDocumentTypeNode(node)) {
    state.nodeCount += 1;
    enforceTreeBudgets(depth, state, 0);

    const doctypeNode: TreeNodeDoctype = {
      kind: "doctype",
      name: readString(node.name),
      publicId: readString(node.publicId),
      systemId: readString(node.systemId)
    };

    return doctypeNode;
  }

  if (!isElementNode(node)) {
    return null;
  }

  state.nodeCount += 1;
  enforceTreeBudgets(depth, state, 0);

  const children: TreeNode[] = [];
  for (const child of node.childNodes) {
    const converted = convertNode(child, depth + 1, state);
    if (converted !== null) {
      children.push(converted);
    }
  }

  const elementNode: TreeNodeElement = {
    kind: "element",
    name: formatElementName(node.namespaceURI, node.tagName),
    attributes: normalizeAttributes(node.attrs, state, 0),
    children
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
  const parsed = parseTree(input, options, errors);
  patchSelectAdoptionCompatibility(parsed);

  const state: BuildState = {
    budgets,
    errors,
    nodeCount: 0
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
