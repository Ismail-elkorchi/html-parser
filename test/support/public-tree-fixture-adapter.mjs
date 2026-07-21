import {
  MATHML_NAMESPACE_URI,
  SVG_NAMESPACE_URI,
  XLINK_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI
} from "../../dist/mod.js";

function fixtureElementName(node) {
  if (node.namespaceUri === SVG_NAMESPACE_URI) return `svg ${node.localName}`;
  if (node.namespaceUri === MATHML_NAMESPACE_URI) return `math ${node.localName}`;
  return node.localName;
}

function fixtureAttributeName(attribute) {
  if (attribute.namespaceUri === XLINK_NAMESPACE_URI) return `xlink ${attribute.localName}`;
  if (attribute.namespaceUri === XML_NAMESPACE_URI) return `xml ${attribute.localName}`;
  if (attribute.namespaceUri === XMLNS_NAMESPACE_URI) return `xmlns ${attribute.localName}`;
  return attribute.localName;
}

function quote(value) {
  return `"${value}"`;
}

function serializeNode(node, level, lines) {
  const indentation = "  ".repeat(level);
  if (node.kind === "text") {
    lines.push(`| ${indentation}${quote(node.value)}`);
    return;
  }
  if (node.kind === "comment") {
    lines.push(`| ${indentation}<!-- ${node.value} -->`);
    return;
  }
  if (node.kind === "processingInstruction") {
    lines.push(`| ${indentation}<?${node.target} ${node.data}?>`);
    return;
  }
  if (node.kind === "doctype") {
    if (node.externalId.kind === "public") {
      lines.push(
        `| ${indentation}<!DOCTYPE ${node.name} ${quote(node.externalId.publicId)} ` +
          `${quote(node.externalId.systemId ?? "")}>`
      );
    } else if (node.externalId.kind === "system") {
      lines.push(
        `| ${indentation}<!DOCTYPE ${node.name} ${quote("")} ` +
          `${quote(node.externalId.systemId)}>`
      );
    } else {
      lines.push(`| ${indentation}<!DOCTYPE ${node.name}>`);
    }
    return;
  }
  if (node.kind === "templateContent") {
    throw new Error("template content must be traversed through its owning element");
  }

  lines.push(`| ${indentation}<${fixtureElementName(node)}>`);
  const attributes = node.attributes
    .map((attribute) => ({ name: fixtureAttributeName(attribute), value: attribute.value }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const attribute of attributes) {
    lines.push(`| ${"  ".repeat(level + 1)}${attribute.name}=${quote(attribute.value)}`);
  }
}

/** Normalizes a public document or fragment into the pinned WPT tree-fixture representation. */
export function normalizePublicTree(tree) {
  const lines = [];
  const stack = [...tree.children].reverse().map((node) => ({ node, level: 0 }));
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    serializeNode(entry.node, entry.level, lines);
    if (entry.node.kind !== "element") continue;
    const templateContent = entry.node.templateContent;
    const children = templateContent?.children ?? entry.node.children;
    const childLevel = templateContent === undefined ? entry.level + 1 : entry.level + 2;
    if (templateContent !== undefined) {
      lines.push(`| ${"  ".repeat(entry.level + 1)}content`);
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) stack.push({ node: child, level: childLevel });
    }
  }
  return lines.join("\n");
}
