import {
  MATHML_NAMESPACE,
  SVG_NAMESPACE,
  XLINK_NAMESPACE,
  XML_NAMESPACE,
  XMLNS_NAMESPACE
} from "../../dist/internal/html-engine/namespaces.js";
import { runHtmlEngine } from "../../dist/internal/html-engine/parser-driver.js";

function fixtureElementName(node) {
  if (node.namespaceUri === SVG_NAMESPACE) return `svg ${node.localName}`;
  if (node.namespaceUri === MATHML_NAMESPACE) return `math ${node.localName}`;
  return node.localName;
}

function fixtureAttributeName(attribute) {
  if (attribute.namespaceUri === XLINK_NAMESPACE) return `xlink ${attribute.localName}`;
  if (attribute.namespaceUri === XML_NAMESPACE) return `xml ${attribute.localName}`;
  if (attribute.namespaceUri === XMLNS_NAMESPACE) return `xmlns ${attribute.localName}`;
  return attribute.qualifiedName;
}

function quote(value) {
  return `"${value}"`;
}

function childArray(model, parent) {
  return [...model.childrenOf(parent)];
}

function serializeNode(model, node, level, lines) {
  const indentation = "  ".repeat(level);
  if (node.kind === "text") {
    lines.push(`| ${indentation}${quote(node.data)}`);
    return;
  }
  if (node.kind === "comment") {
    lines.push(`| ${indentation}<!-- ${node.data} -->`);
    return;
  }
  if (node.kind === "processing-instruction") {
    lines.push(`| ${indentation}<?${node.target} ${node.data}?>`);
    return;
  }
  if (node.kind === "doctype") {
    if (node.externalId.kind === "public") {
      lines.push(
        `| ${indentation}<!DOCTYPE ${node.name} ${quote(node.externalId.publicIdentifier)} ` +
          `${quote(node.externalId.systemIdentifier ?? "")}>`
      );
    } else if (node.externalId.kind === "system") {
      lines.push(
        `| ${indentation}<!DOCTYPE ${node.name} ${quote("")} ` +
          `${quote(node.externalId.systemIdentifier)}>`
      );
    } else {
      lines.push(`| ${indentation}<!DOCTYPE ${node.name}>`);
    }
    return;
  }

  lines.push(`| ${indentation}<${fixtureElementName(node)}>`);
  const attributes = [...model.attributesOf(node)]
    .map((attribute) => ({ name: fixtureAttributeName(attribute), value: attribute.value }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const attribute of attributes) {
    lines.push(`| ${"  ".repeat(level + 1)}${attribute.name}=${quote(attribute.value)}`);
  }
}

/** Serializes a direct engine model in html5lib tree-fixture form. */
export function normalizeTree(model) {
  const lines = [];
  const stack = childArray(model, model.root)
    .reverse()
    .map((node) => ({ node, level: 0 }));
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    serializeNode(model, entry.node, entry.level, lines);
    if (entry.node.kind !== "element") continue;
    const parent = entry.node.templateContents ?? entry.node;
    const childLevel = entry.node.templateContents === null ? entry.level + 1 : entry.level + 2;
    if (entry.node.templateContents !== null) {
      lines.push(`| ${"  ".repeat(entry.level + 1)}content`);
    }
    const children = childArray(model, parent);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) stack.push({ node: child, level: childLevel });
    }
  }
  return lines.join("\n");
}

/** Runs one html5lib tree fixture through the production engine. */
export function buildTreeFromHtml(html, budgets = {}, options = {}) {
  const fragmentContext = options.fragmentContext ?? null;
  const result = runHtmlEngine({
    inputChunks: [html],
    parser: fragmentContext === null
      ? {
          kind: "document",
          scriptingMode: options.scriptingEnabled ? "inert" : "disabled"
        }
      : {
          kind: "fragment",
          scriptingMode: options.scriptingEnabled ? "inert" : "disabled",
          documentMode: options.documentMode ?? "no-quirks",
          hasFormInContextChain: options.hasFormInContextChain ?? false,
          context: {
            namespaceUri: fragmentContext.namespaceUri,
            localName: fragmentContext.localName,
            attributes: fragmentContext.attributes ?? []
          }
        },
    limits: {
      maxSteps: budgets.maxSteps ?? 1_000_000,
      maxNodes: budgets.maxNodes ?? 100_000,
      maxDepth: budgets.maxDepth ?? 10_000,
      maxParseErrors: budgets.maxParseErrors ?? 100_000,
      maxAttributesPerElement: budgets.maxAttributesPerElement ?? 10_000,
      maxAttributeUtf8BytesPerElement: budgets.maxAttributeBytes ?? 10_000_000
    }
  });
  return {
    document: result.model,
    errors: result.parseErrors.map((error) => ({
      code: error.code,
      startOffset: error.span.startUtf16Offset,
      endOffset: error.span.endUtf16Offset
    })),
    resourceUsage: result.resources
  };
}
