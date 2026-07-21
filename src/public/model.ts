import { HtmlConfigurationError } from "./errors.ts";

import type { OperationContext } from "./operation.ts";
import type { ElementNode, HtmlNode } from "./types.ts";

type UnknownRecord = Readonly<Record<PropertyKey, unknown>>;

function invalidModel(option: string, expected: string): never {
  throw new HtmlConfigurationError(option, "INVALID_VALUE", expected);
}

function modelRecord(value: unknown, option: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidModel(option, "must be a node record");
  }
  return value as UnknownRecord;
}

function modelArray(value: unknown, option: string): readonly unknown[] {
  if (!Array.isArray(value)) invalidModel(option, "must be a dense array");
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) invalidModel(option, "must be a dense array");
  }
  return value;
}

function modelString(value: unknown, option: string): string {
  if (typeof value !== "string") invalidModel(option, "must be a string");
  return value;
}

function validateAttributeShape(value: unknown, option: string): void {
  const attribute = modelRecord(value, option);
  const namespaceUri = attribute["namespaceUri"];
  if (namespaceUri !== null && typeof namespaceUri !== "string") {
    invalidModel(option, "must contain a string or null namespaceUri");
  }
  modelString(attribute["localName"], option);
  modelString(attribute["value"], option);
  if (attribute["prefix"] !== undefined) modelString(attribute["prefix"], option);
}

/** Validates the complete shape read by element query helpers. @internal */
export function requireElementNode(value: unknown, option: string): ElementNode {
  const element = modelRecord(value, option);
  if (element["kind"] !== "element") invalidModel(option, "must be an element node");
  if (!Number.isSafeInteger(element["id"]) || (element["id"] as number) < 1) {
    invalidModel(option, "must have a positive safe-integer id");
  }
  modelString(element["namespaceUri"], option);
  modelString(element["localName"], option);
  if (element["prefix"] !== undefined) modelString(element["prefix"], option);
  const attributes = modelArray(element["attributes"], option);
  for (const attribute of attributes) validateAttributeShape(attribute, option);
  modelArray(element["children"], option);
  return value as ElementNode;
}

function requireTraversableNode(value: unknown): HtmlNode {
  const node = modelRecord(value, "tree");
  const kind = node["kind"];
  if (!Number.isSafeInteger(node["id"]) || (node["id"] as number) < 1) {
    invalidModel("tree", "must contain nodes with positive safe-integer ids");
  }
  if (kind === "element") return requireElementNode(value, "tree");
  if (kind === "templateContent") {
    modelArray(node["children"], "tree");
  } else if (kind === "text" || kind === "comment") {
    modelString(node["value"], "tree");
  } else if (kind === "processingInstruction") {
    modelString(node["target"], "tree");
    modelString(node["data"], "tree");
  } else if (kind === "doctype") {
    modelString(node["name"], "tree");
    modelRecord(node["externalId"], "tree");
  } else {
    invalidModel("tree", "must contain only supported HTML node kinds");
  }
  return value as HtmlNode;
}

/** HTML namespace URI assigned by the tree builder. */
export const HTML_NAMESPACE_URI = "http://www.w3.org/1999/xhtml";
/** SVG namespace URI assigned by the tree builder. */
export const SVG_NAMESPACE_URI = "http://www.w3.org/2000/svg";
/** MathML namespace URI assigned by the tree builder. */
export const MATHML_NAMESPACE_URI = "http://www.w3.org/1998/Math/MathML";
/** XLink namespace URI used by adjusted foreign attributes. */
export const XLINK_NAMESPACE_URI = "http://www.w3.org/1999/xlink";
/** XML namespace URI used by adjusted foreign attributes. */
export const XML_NAMESPACE_URI = "http://www.w3.org/XML/1998/namespace";
/** XMLNS namespace URI used by namespace declaration attributes. */
export const XMLNS_NAMESPACE_URI = "http://www.w3.org/2000/xmlns/";

/** @internal */
export function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

/** @internal */
export function isHtmlElement(
  node: HtmlNode
): node is Extract<HtmlNode, { kind: "element" }> {
  return node.kind === "element" && node.namespaceUri === HTML_NAMESPACE_URI;
}

/** @internal */
export function ownedChildNodes(node: HtmlNode): readonly HtmlNode[] {
  if (node.kind === "templateContent") return node.children;
  if (node.kind !== "element") return [];
  return node.templateContent === undefined ? node.children : [node.templateContent];
}

/** Rejects cyclic and multiply-owned caller graphs during public traversal. @internal */
export class OwnedNodeTracker {
  readonly #seen = new WeakSet<object>();

  observe(value: unknown): HtmlNode {
    const node = requireTraversableNode(value);
    if (this.#seen.has(node)) {
      throw new HtmlConfigurationError(
        "tree",
        "INVALID_VALUE",
        "must be acyclic and give every node exactly one owner"
      );
    }
    this.#seen.add(node);
    return node;
  }
}

/** @internal */
export function* iterateNodes(
  nodes: readonly HtmlNode[],
  depth: number,
  operation: OperationContext
): IterableIterator<{ readonly node: HtmlNode; readonly depth: number }> {
  const stack: { readonly node: HtmlNode; readonly depth: number }[] = [];
  const ownership = new OwnedNodeTracker();
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node !== undefined) stack.push({ node, depth });
  }
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) continue;
    operation.checkpoint();
    const node = ownership.observe(entry.node);
    yield { node, depth: entry.depth };
    const descendants = ownedChildNodes(node);
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      const child = descendants[index];
      if (child !== undefined) stack.push({ node: child, depth: entry.depth + 1 });
    }
  }
}

/** @internal */
export function countNodes(node: HtmlNode, operation: OperationContext): number {
  let count = 0;
  const stack: HtmlNode[] = [node];
  const ownership = new OwnedNodeTracker();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    operation.checkpoint();
    const node = ownership.observe(current);
    count += 1;
    const descendants = ownedChildNodes(node);
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      const child = descendants[index];
      if (child !== undefined) stack.push(child);
    }
  }
  return count;
}
