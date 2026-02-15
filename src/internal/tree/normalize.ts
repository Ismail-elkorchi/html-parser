import type { TreeNode, TreeNodeDocument } from "./types.js";

function indent(level: number): string {
  return "  ".repeat(level);
}

function quoteRaw(value: string): string {
  return `"${value}"`;
}

function normalizeNode(node: TreeNode, level: number, lines: string[]): void {
  if (node.kind === "element") {
    lines.push(`| ${indent(level)}<${node.name}>`);

    for (const [name, value] of Object.entries(node.attributes)) {
      lines.push(`| ${indent(level + 1)}${name}=${quoteRaw(value)}`);
    }

    for (const child of node.children) {
      normalizeNode(child, level + 1, lines);
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

  const publicId = node.publicId;
  const systemId = node.systemId;

  if (publicId.length > 0 || systemId.length > 0) {
    lines.push(`| ${indent(level)}<!DOCTYPE ${node.name} ${quoteRaw(publicId)} ${quoteRaw(systemId)}>`); // Tree fixtures use this compact doctype form.
    return;
  }

  lines.push(`| ${indent(level)}<!DOCTYPE ${node.name}>`);
}

export function normalizeTree(document: TreeNodeDocument): string {
  const lines: string[] = [];
  for (const child of document.children) {
    normalizeNode(child, 0, lines);
  }
  return lines.join("\n");
}
