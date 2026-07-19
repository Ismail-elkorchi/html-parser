import type { TreeNode, TreeNodeDocument } from "./types.js";

const HTML_NAMESPACE_URI = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE_URI = "http://www.w3.org/2000/svg";
const MATHML_NAMESPACE_URI = "http://www.w3.org/1998/Math/MathML";
const XLINK_NAMESPACE_URI = "http://www.w3.org/1999/xlink";
const XML_NAMESPACE_URI = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE_URI = "http://www.w3.org/2000/xmlns/";

function indent(level: number): string {
  return "  ".repeat(level);
}

function quoteRaw(value: string): string {
  return `"${value}"`;
}

function fixtureElementName(namespaceUri: string, localName: string): string {
  if (namespaceUri === HTML_NAMESPACE_URI) {
    return localName;
  }
  if (namespaceUri === SVG_NAMESPACE_URI) {
    return `svg ${localName}`;
  }
  if (namespaceUri === MATHML_NAMESPACE_URI) {
    return `math ${localName}`;
  }
  return `${namespaceUri} ${localName}`;
}

function fixtureAttributeName(
  namespaceUri: string | null,
  localName: string,
  qualifiedName: string
): string {
  if (namespaceUri === XLINK_NAMESPACE_URI) {
    return `xlink ${localName}`;
  }
  if (namespaceUri === XML_NAMESPACE_URI) {
    return `xml ${localName}`;
  }
  if (namespaceUri === XMLNS_NAMESPACE_URI) {
    return `xmlns ${localName}`;
  }
  return qualifiedName;
}

function normalizeNode(node: TreeNode, level: number, lines: string[]): void {
  if (node.kind === "element") {
    lines.push(`| ${indent(level)}<${fixtureElementName(node.namespaceUri, node.localName)}>`);

    for (const attribute of node.attributes) {
      const name = fixtureAttributeName(
        attribute.namespaceUri,
        attribute.localName,
        attribute.name
      );
      lines.push(`| ${indent(level + 1)}${name}=${quoteRaw(attribute.value)}`);
    }

    return;
  }

  if (node.kind === "text") {
    lines.push(`| ${indent(level)}${quoteRaw(node.value)}`);
    return;
  }

  if (node.kind === "comment") {
    lines.push(`| ${indent(level)}<!-- ${node.value} -->`);
    return;
  }

  if (node.externalId.kind === "public") {
    lines.push(`| ${indent(level)}<!DOCTYPE ${node.name} ${quoteRaw(node.externalId.publicId)} ${quoteRaw(node.externalId.systemId ?? "")}>`); // Tree fixtures use this compact doctype form.
    return;
  }

  if (node.externalId.kind === "system") {
    lines.push(`| ${indent(level)}<!DOCTYPE ${node.name} ${quoteRaw("")} ${quoteRaw(node.externalId.systemId)}>`); // Tree fixtures use this compact doctype form.
    return;
  }

  lines.push(`| ${indent(level)}<!DOCTYPE ${node.name}>`);
}

export function normalizeTree(document: TreeNodeDocument): string {
  const lines: string[] = [];
  const stack: { readonly node: TreeNode; readonly level: number }[] = [];
  for (let index = document.children.length - 1; index >= 0; index -= 1) {
    const child = document.children[index];
    if (child !== undefined) {
      stack.push({ node: child, level: 0 });
    }
  }
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) {
      continue;
    }
    normalizeNode(entry.node, entry.level, lines);
    if (entry.node.kind === "element") {
      for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
        const child = entry.node.children[index];
        if (child !== undefined) {
          stack.push({ node: child, level: entry.level + 1 });
        }
      }
    }
  }
  return lines.join("\n");
}
