import type { OperationContext } from "./operation.ts";
import type { HtmlNode } from "./types.ts";

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

/** @internal */
export function* iterateNodes(
  nodes: readonly HtmlNode[],
  depth: number,
  operation: OperationContext
): IterableIterator<{ readonly node: HtmlNode; readonly depth: number }> {
  const stack: { readonly node: HtmlNode; readonly depth: number }[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node !== undefined) stack.push({ node, depth });
  }
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) continue;
    operation.checkpoint();
    yield entry;
    const descendants = ownedChildNodes(entry.node);
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
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    operation.checkpoint();
    count += 1;
    const descendants = ownedChildNodes(current);
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      const child = descendants[index];
      if (child !== undefined) stack.push(child);
    }
  }
  return count;
}
