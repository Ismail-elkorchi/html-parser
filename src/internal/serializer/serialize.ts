import type { TreeAttribute, TreeNode, TreeNodeDocument } from "../tree/types.js";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);
const HTML_NAMESPACE_URI = "http://www.w3.org/1999/xhtml";

function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string, quote: "\"" | "'"): string {
  const escapedAmp = value.replace(/&/g, "&amp;");
  if (quote === "\"") {
    return escapedAmp.replace(/"/g, "&quot;");
  }

  return escapedAmp.replace(/'/g, "&#39;");
}

function chooseQuote(value: string): "\"" | "'" | null {
  if (/^[^\s"'=<>`]+$/.test(value)) {
    return null;
  }

  if (!value.includes("\"")) {
    return "\"";
  }

  if (!value.includes("'")) {
    return "'";
  }

  return "\"";
}

function serializeAttributes(attributes: readonly TreeAttribute[]): string {
  if (attributes.length === 0) {
    return "";
  }

  const parts = attributes.map(({ name, value }) => {
    const quote = chooseQuote(value);
    if (quote === null) {
      return `${name}=${escapeAttribute(value, "\"")}`;
    }

    return `${name}=${quote}${escapeAttribute(value, quote)}${quote}`;
  });

  return ` ${parts.join(" ")}`;
}

function quoteDoctypeIdentifier(value: string): string {
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  throw new Error("DOCTYPE identifier cannot be serialized losslessly");
}

function serializeTreeNodes(nodes: readonly TreeNode[]): string {
  type Action = { readonly kind: "node"; readonly node: TreeNode } |
    { readonly kind: "text"; readonly value: string };
  const parts: string[] = [];
  const stack: Action[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node !== undefined) {
      stack.push({ kind: "node", node });
    }
  }
  while (stack.length > 0) {
    const action = stack.pop();
    if (action === undefined) {
      continue;
    }
    if (action.kind === "text") {
      parts.push(action.value);
      continue;
    }
    const node = action.node;
    if (node.kind === "text") {
      parts.push(escapeText(node.value));
    } else if (node.kind === "comment") {
      parts.push(`<!--${node.value}-->`);
    } else if (node.kind === "doctype") {
      if (node.externalId.kind === "none") {
        parts.push(`<!DOCTYPE ${node.name}>`);
      } else if (node.externalId.kind === "system") {
        parts.push(`<!DOCTYPE ${node.name} SYSTEM ${quoteDoctypeIdentifier(node.externalId.systemId)}>`);
      } else {
        const systemId = node.externalId.systemId === null
          ? ""
          : ` ${quoteDoctypeIdentifier(node.externalId.systemId)}`;
        parts.push(`<!DOCTYPE ${node.name} PUBLIC ${quoteDoctypeIdentifier(node.externalId.publicId)}${systemId}>`);
      }
    } else {
      const tagName = node.name;
      parts.push(`<${tagName}${serializeAttributes(node.attributes)}>`);
      const isHtmlVoid = node.namespaceUri === HTML_NAMESPACE_URI &&
        VOID_ELEMENTS.has(asciiLowercase(node.localName));
      if (!isHtmlVoid) {
        stack.push({ kind: "text", value: `</${tagName}>` });
        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          const child = node.children[index];
          if (child !== undefined) {
            stack.push({ kind: "node", node: child });
          }
        }
      }
    }
  }
  return parts.join("");
}

export function serializeTreeDocument(document: TreeNodeDocument): string {
  return serializeTreeNodes(document.children);
}
