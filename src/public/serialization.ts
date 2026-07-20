import { HtmlConfigurationError } from "./errors.ts";
import { HTML_NAMESPACE_URI, asciiLowercase } from "./model.ts";
import {
  createOperationContext,
  normalizeOperationOptions
} from "./operation.ts";

import type { OperationContext } from "./operation.ts";
import type {
  DocumentTree,
  FragmentTree,
  HtmlNode,
  OperationOptions
} from "./types.ts";

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

/** HTML namespace URI assigned by the tree builder. */
export function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function quoteDoctypeIdentifier(value: string): string {
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  throw new HtmlConfigurationError(
    "tree",
    "INVALID_VALUE",
    "DOCTYPE identifiers containing both quote characters cannot be serialized losslessly"
  );
}

function serializeDoctype(node: Extract<HtmlNode, { kind: "doctype" }>): string {
  if (node.externalId.kind === "none") {
    return `<!DOCTYPE ${node.name}>`;
  }
  if (node.externalId.kind === "system") {
    return `<!DOCTYPE ${node.name} SYSTEM ${quoteDoctypeIdentifier(node.externalId.systemId)}>`;
  }
  const systemId = node.externalId.systemId === null
    ? ""
    : ` ${quoteDoctypeIdentifier(node.externalId.systemId)}`;
  return `<!DOCTYPE ${node.name} PUBLIC ${quoteDoctypeIdentifier(node.externalId.publicId)}${systemId}>`;
}

export function serializeNodes(nodes: readonly HtmlNode[], operation: OperationContext): string {
  type Action = { readonly kind: "node"; readonly node: HtmlNode } |
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
    operation.checkpoint();
    if (action.kind === "text") {
      parts.push(action.value);
      continue;
    }
    const node = action.node;
    if (node.kind === "text") {
      parts.push(escapeText(node.value));
    } else if (node.kind === "comment") {
      parts.push(`<!--${node.value}-->`);
    } else if (node.kind === "processingInstruction") {
      parts.push(`<?${node.target} ${node.data}?>`);
    } else if (node.kind === "doctype") {
      parts.push(serializeDoctype(node));
    } else if (node.kind === "templateContent") {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        if (child !== undefined) stack.push({ kind: "node", node: child });
      }
    } else {
      const attributes = node.attributes
        .map((entry) => `${entry.name}="${escapeAttribute(entry.value)}"`)
        .join(" ");
      const open = attributes.length > 0
        ? `<${node.tagName} ${attributes}>`
        : `<${node.tagName}>`;
      parts.push(open);
      const isHtmlVoid = node.namespaceUri === HTML_NAMESPACE_URI &&
        VOID_ELEMENTS.has(asciiLowercase(node.localName));
      if (!isHtmlVoid) {
        stack.push({ kind: "text", value: `</${node.tagName}>` });
        const children = node.templateContent?.children ?? node.children;
        for (let index = children.length - 1; index >= 0; index -= 1) {
          const child = children[index];
          if (child !== undefined) {
            stack.push({ kind: "node", node: child });
          }
        }
      }
    }
  }
  return parts.join("");
}

/** Serializes a parsed tree or node as HTML. */
export function serialize(
  tree: DocumentTree | FragmentTree | HtmlNode,
  options: OperationOptions = {}
): string {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  if (tree.kind === "document" || tree.kind === "fragment") {
    return serializeNodes(tree.children, operation);
  }

  return serializeNodes([tree], operation);
}
