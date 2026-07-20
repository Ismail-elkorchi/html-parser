import { requireString } from "./html-input.ts";
import {
  asciiLowercase,
  isHtmlElement,
  iterateNodes
} from "./model.ts";
import {
  createOperationContext,
  normalizeOperationOptions
} from "./operation.ts";

import type { OperationContext } from "./operation.ts";
import type {
  DocumentTree,
  ElementVisitor,
  FragmentTree,
  HtmlNode,
  NodeId,
  NodeVisitor,
  OperationOptions
} from "./types.ts";

/** Visits every node in depth-first tree order. */
export function walk(
  tree: DocumentTree | FragmentTree,
  visitor: NodeVisitor,
  options: OperationOptions = {}
): void {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    visitor(entry.node, entry.depth);
    operation.checkpoint();
  }
}

/** Visits every element in depth-first tree order. */
export function walkElements(
  tree: DocumentTree | FragmentTree,
  visitor: ElementVisitor,
  options: OperationOptions = {}
): void {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (entry.node.kind === "element") {
      visitor(entry.node, entry.depth);
      operation.checkpoint();
    }
  }
}

/** Finds a node by its parser-assigned identity. */
export function findById(
  tree: DocumentTree | FragmentTree,
  id: NodeId,
  options: OperationOptions = {}
): HtmlNode | null {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (entry.node.id === id) {
      return entry.node;
    }
  }

  return null;
}

function* findAllByTagNameIterator(
  tree: DocumentTree | FragmentTree,
  tagName: string,
  operation: OperationContext
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const normalized = asciiLowercase(tagName);
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (isHtmlElement(entry.node) && asciiLowercase(entry.node.localName) === normalized) {
      yield entry.node;
    }
  }
}

/** Finds elements by ASCII case-insensitive HTML tag name. */
export function findAllByTagName(
  tree: DocumentTree | FragmentTree,
  tagName: string,
  options: OperationOptions = {}
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  return findAllByTagNameIterator(tree, tagName, operation);
}

function* findAllByTagNameNSIterator(
  tree: DocumentTree | FragmentTree,
  namespaceUri: string,
  localName: string,
  operation: OperationContext
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (
      entry.node.kind === "element" &&
      entry.node.namespaceUri === namespaceUri &&
      entry.node.localName === localName
    ) {
      yield entry.node;
    }
  }
}

/** Finds elements by exact namespace URI and local name. */
export function findAllByTagNameNS(
  tree: DocumentTree | FragmentTree,
  namespaceUri: string,
  localName: string,
  options: OperationOptions = {}
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const startedAt = performance.now();
  requireString(namespaceUri, "namespaceUri");
  requireString(localName, "localName");
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  return findAllByTagNameNSIterator(tree, namespaceUri, localName, operation);
}


function* findAllByAttrIterator(
  tree: DocumentTree | FragmentTree,
  name: string,
  value: string | undefined,
  operation: OperationContext
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const normalizedName = asciiLowercase(name);
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (!isHtmlElement(entry.node)) {
      continue;
    }

    const matched = entry.node.attributes.some(
      (attribute) =>
        attribute.namespaceUri === null &&
        asciiLowercase(attribute.localName) === normalizedName &&
        (value === undefined || attribute.value === value)
    );
    if (matched) {
      yield entry.node;
    }
  }
}

/** Finds elements carrying an attribute and optional value, with operation controls. */
export function findAllByAttr(
  tree: DocumentTree | FragmentTree,
  name: string,
  value?: string,
  options: OperationOptions = {}
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  return findAllByAttrIterator(tree, name, value, operation);
}

function* findAllByAttrNSIterator(
  tree: DocumentTree | FragmentTree,
  namespaceUri: string | null,
  localName: string,
  value: string | undefined,
  operation: OperationContext
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (entry.node.kind !== "element") {
      continue;
    }
    const matched = entry.node.attributes.some((attribute) =>
      attribute.namespaceUri === namespaceUri &&
      attribute.localName === localName &&
      (value === undefined || attribute.value === value)
    );
    if (matched) {
      yield entry.node;
    }
  }
}

/** Finds elements carrying an attribute with an exact expanded name. */
export function findAllByAttrNS(
  tree: DocumentTree | FragmentTree,
  namespaceUri: string | null,
  localName: string,
  value?: string,
  options: OperationOptions = {}
): IterableIterator<Extract<HtmlNode, { kind: "element" }>> {
  const startedAt = performance.now();
  if (namespaceUri !== null) {
    requireString(namespaceUri, "namespaceUri");
  }
  requireString(localName, "localName");
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  return findAllByAttrNSIterator(tree, namespaceUri, localName, value, operation);
}
