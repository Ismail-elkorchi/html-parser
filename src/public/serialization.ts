import { HtmlConfigurationError } from "./errors.ts";
import {
  escapeHtmlAttribute,
  escapeHtmlText,
  serializedAttributeName,
  serializedElementName,
  serializesAsVoid,
  serializesTextLiterally
} from "./html-serialization-rules.ts";
import {
  createOperationContext,
  normalizeSerializeOptions
} from "./operation.ts";

import type { OperationContext } from "./operation.ts";
import type {
  DocumentTree,
  ElementNode,
  FragmentTree,
  HtmlNode,
  HtmlScriptingMode,
  SerializeOptions
} from "./types.ts";

function quoteDoctypeIdentifier(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  throw new HtmlConfigurationError(
    "tree",
    "INVALID_VALUE",
    "DOCTYPE identifiers containing both quote characters cannot be serialized losslessly"
  );
}

function serializeDoctype(node: Extract<HtmlNode, { kind: "doctype" }>): string {
  if (node.externalId.kind === "none") return `<!DOCTYPE ${node.name}>`;
  if (node.externalId.kind === "system") {
    return `<!DOCTYPE ${node.name} SYSTEM ${quoteDoctypeIdentifier(node.externalId.systemId)}>`;
  }
  const systemId = node.externalId.systemId === null
    ? ""
    : ` ${quoteDoctypeIdentifier(node.externalId.systemId)}`;
  return `<!DOCTYPE ${node.name} PUBLIC ${quoteDoctypeIdentifier(node.externalId.publicId)}${systemId}>`;
}

interface NodeAction {
  readonly kind: "node";
  readonly node: HtmlNode;
  readonly parent: ElementNode | null;
}

interface MarkupAction {
  readonly kind: "markup";
  readonly value: string;
}

type SerializationAction = NodeAction | MarkupAction;

/** Serializes sibling nodes with their actual parent context. */
export function serializeNodes(
  nodes: readonly HtmlNode[],
  operation: OperationContext,
  parent: ElementNode | null = null,
  scriptingMode: HtmlScriptingMode = "inert"
): string {
  const parts: string[] = [];
  const stack: SerializationAction[] = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node !== undefined) stack.push({ kind: "node", node, parent });
  }

  while (stack.length > 0) {
    const action = stack.pop();
    if (action === undefined) continue;
    operation.checkpoint();
    if (action.kind === "markup") {
      parts.push(action.value);
      continue;
    }

    const { node } = action;
    if (node.kind === "text") {
      parts.push(
        serializesTextLiterally(action.parent, scriptingMode)
          ? node.value
          : escapeHtmlText(node.value)
      );
      continue;
    }
    if (node.kind === "comment") {
      parts.push(`<!--${node.value}-->`);
      continue;
    }
    if (node.kind === "processingInstruction") {
      parts.push(`<?${node.target} ${node.data}?>`);
      continue;
    }
    if (node.kind === "doctype") {
      parts.push(serializeDoctype(node));
      continue;
    }
    if (node.kind === "templateContent") {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        if (child !== undefined) stack.push({ kind: "node", node: child, parent: null });
      }
      continue;
    }

    const tagName = serializedElementName(node);
    const attributes = node.attributes
      .map((attribute) => `${serializedAttributeName(attribute)}="${escapeHtmlAttribute(attribute.value)}"`)
      .join(" ");
    parts.push(attributes.length > 0 ? `<${tagName} ${attributes}>` : `<${tagName}>`);
    if (serializesAsVoid(node)) continue;

    stack.push({ kind: "markup", value: `</${tagName}>` });
    const children = node.templateContent?.children ?? node.children;
    const childParent = node.templateContent === undefined ? node : null;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) stack.push({ kind: "node", node: child, parent: childParent });
    }
  }
  return parts.join("");
}

/** Serializes a parsed tree or one complete node representation as HTML. */
export function serialize(
  tree: DocumentTree | FragmentTree | HtmlNode,
  options: SerializeOptions = {}
): string {
  const startedAt = performance.now();
  const normalizedOptions = normalizeSerializeOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  const scriptingMode = normalizedOptions.scriptingMode ??
    (tree.kind === "document" || tree.kind === "fragment" ? tree.scriptingMode : "inert");
  if (tree.kind === "document" || tree.kind === "fragment") {
    return serializeNodes(tree.children, operation, null, scriptingMode);
  }
  return serializeNodes([tree], operation, null, scriptingMode);
}
