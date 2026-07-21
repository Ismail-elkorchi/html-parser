import {
  isHtmlAttributeName,
  isHtmlElementName,
  isXmlLocalName
} from "../internal/foundation/name-validation.ts";

import { HtmlConfigurationError } from "./errors.ts";
import {
  HTML_NAMESPACE_URI,
  MATHML_NAMESPACE_URI,
  SVG_NAMESPACE_URI,
  XLINK_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
  asciiLowercase
} from "./model.ts";
import { isParserOwnedTree } from "./parsed-output-registry.ts";

import type { OperationContext } from "./operation.ts";
import type {
  Attribute,
  DocumentTree,
  FragmentTree,
  SerializableNode,
  Span
} from "./types.ts";

type UnknownRecord = Readonly<Record<PropertyKey, unknown>>;
type ChildPlacement = "document" | "fragment" | "element" | "template" | "standalone";

interface PendingNode {
  readonly value: unknown;
  readonly path: string;
  readonly placement: ChildPlacement;
}

function invalid(path: string, expected: string): never {
  throw new HtmlConfigurationError(path, "INVALID_VALUE", expected);
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "must be a node record");
  }
  return value as UnknownRecord;
}

function read(value: UnknownRecord, key: PropertyKey, path: string): unknown {
  try {
    return value[key];
  } catch {
    invalid(path, "must be a readable data property");
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") invalid(path, "must be a string");
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value !== undefined && typeof value !== "string") {
    invalid(path, "must be a string when provided");
  }
  return value;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(path, "must be a dense array");
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) invalid(`${path}[${String(index)}]`, "must be present");
  }
  return value;
}

function nodeId(value: unknown, path: string, ids: Set<number>): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalid(path, "must be a positive safe integer");
  }
  const id = value as number;
  if (ids.has(id)) invalid(path, "must be unique within the serialized tree");
  ids.add(id);
}

function span(value: unknown, path: string): Span | undefined {
  if (value === undefined) return undefined;
  const source = record(value, path);
  const start = read(source, "start", `${path}.start`);
  const end = read(source, "end", `${path}.end`);
  if (!Number.isSafeInteger(start) || (start as number) < 0) {
    invalid(`${path}.start`, "must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(end) || (end as number) < (start as number)) {
    invalid(`${path}.end`, "must be a safe integer no smaller than span.start");
  }
  return value as Span;
}

function nodeSourceFields(value: UnknownRecord, path: string): void {
  const sourceSpan = span(read(value, "span", `${path}.span`), `${path}.span`);
  const provenance = read(value, "spanProvenance", `${path}.spanProvenance`);
  if (provenance !== undefined && provenance !== "input" && provenance !== "inferred") {
    invalid(`${path}.spanProvenance`, 'must be "input" or "inferred" when provided');
  }
  if (sourceSpan !== undefined && provenance !== "input") {
    invalid(`${path}.spanProvenance`, 'must be "input" when span is present');
  }
  if (provenance === "input" && sourceSpan === undefined) {
    invalid(`${path}.span`, 'must be present when spanProvenance is "input"');
  }
  if (provenance === "inferred" && sourceSpan !== undefined) {
    invalid(`${path}.span`, 'must be absent when spanProvenance is "inferred"');
  }
}

function expectedAttributePrefix(
  namespaceUri: string,
  localName: string
): string | undefined | null {
  if (namespaceUri === XLINK_NAMESPACE_URI) return "xlink";
  if (namespaceUri === XML_NAMESPACE_URI) return "xml";
  if (namespaceUri === XMLNS_NAMESPACE_URI) return localName === "xmlns" ? undefined : "xmlns";
  return null;
}

function validateAttribute(
  value: unknown,
  path: string,
  htmlElement: boolean
): { readonly expandedName: string; readonly serializedName: string } {
  const source = record(value, path);
  const namespaceValue = read(source, "namespaceUri", `${path}.namespaceUri`);
  if (namespaceValue !== null && (typeof namespaceValue !== "string" || namespaceValue.length === 0)) {
    invalid(`${path}.namespaceUri`, "must be null or a non-empty namespace URI");
  }
  const namespaceUri = namespaceValue;
  const localName = string(read(source, "localName", `${path}.localName`), `${path}.localName`);
  const prefix = optionalString(read(source, "prefix", `${path}.prefix`), `${path}.prefix`);
  string(read(source, "value", `${path}.value`), `${path}.value`);
  span(read(source, "span", `${path}.span`), `${path}.span`);

  if (namespaceUri === null) {
    if (prefix !== undefined) invalid(`${path}.prefix`, "must be absent for an unnamespaced attribute");
    if (!isHtmlAttributeName(localName)) {
      invalid(`${path}.localName`, "must be safely representable as one HTML attribute name");
    }
    if (htmlElement && localName !== asciiLowercase(localName)) {
      invalid(`${path}.localName`, "must use normalized ASCII lowercase on an HTML element");
    }
  } else {
    if (!isXmlLocalName(localName)) {
      invalid(`${path}.localName`, "must be an XML local name for a namespaced attribute");
    }
    if (prefix !== undefined && !isXmlLocalName(prefix)) {
      invalid(`${path}.prefix`, "must be an XML local name when provided");
    }
    const expectedPrefix = expectedAttributePrefix(namespaceUri, localName);
    if (expectedPrefix !== null && prefix !== undefined && prefix !== expectedPrefix) {
      invalid(`${path}.prefix`, "must match the reserved attribute namespace");
    }
    if (expectedPrefix === null && (prefix === "xml" || prefix === "xmlns")) {
      invalid(`${path}.prefix`, "must not use a reserved prefix for another namespace");
    }
  }

  const serializedName = namespaceUri === null
    ? localName
    : namespaceUri === XML_NAMESPACE_URI
      ? `xml:${localName}`
      : namespaceUri === XMLNS_NAMESPACE_URI
        ? localName === "xmlns" ? "xmlns" : `xmlns:${localName}`
        : namespaceUri === XLINK_NAMESPACE_URI
          ? `xlink:${localName}`
          : prefix === undefined ? localName : `${prefix}:${localName}`;
  return {
    expandedName: `${namespaceUri ?? ""}\u0000${localName}`,
    serializedName: asciiLowercase(serializedName)
  };
}

function validateAttributes(
  value: unknown,
  path: string,
  htmlElement: boolean
): readonly Attribute[] {
  const attributes = array(value, path);
  const expandedNames = new Set<string>();
  const serializedNames = new Set<string>();
  for (let index = 0; index < attributes.length; index += 1) {
    const attributePath = `${path}[${String(index)}]`;
    const identity = validateAttribute(attributes[index], attributePath, htmlElement);
    if (expandedNames.has(identity.expandedName)) {
      invalid(attributePath, "must have a unique namespace and local name");
    }
    if (serializedNames.has(identity.serializedName)) {
      invalid(attributePath, "must have a unique serialized HTML name");
    }
    expandedNames.add(identity.expandedName);
    serializedNames.add(identity.serializedName);
  }
  return value as readonly Attribute[];
}

function validateElementIdentity(value: UnknownRecord, path: string): {
  readonly namespaceUri: string;
  readonly localName: string;
} {
  const namespaceUri = string(
    read(value, "namespaceUri", `${path}.namespaceUri`),
    `${path}.namespaceUri`
  );
  if (namespaceUri.length === 0) invalid(`${path}.namespaceUri`, "must be a non-empty namespace URI");
  const localName = string(read(value, "localName", `${path}.localName`), `${path}.localName`);
  const prefix = optionalString(read(value, "prefix", `${path}.prefix`), `${path}.prefix`);
  const parserNamespace = namespaceUri === HTML_NAMESPACE_URI ||
    namespaceUri === SVG_NAMESPACE_URI || namespaceUri === MATHML_NAMESPACE_URI;
  if (parserNamespace) {
    if (prefix !== undefined) {
      invalid(`${path}.prefix`, "must be absent for HTML, SVG, and MathML parser elements");
    }
    if (!isHtmlElementName(localName)) {
      invalid(`${path}.localName`, "must be safely representable as one HTML element name");
    }
    if (namespaceUri === HTML_NAMESPACE_URI && localName !== asciiLowercase(localName)) {
      invalid(`${path}.localName`, "must use normalized ASCII lowercase in the HTML namespace");
    }
  } else {
    if (!isXmlLocalName(localName)) {
      invalid(`${path}.localName`, "must be an XML local name in a custom namespace");
    }
    if (prefix !== undefined && !isXmlLocalName(prefix)) {
      invalid(`${path}.prefix`, "must be an XML local name when provided");
    }
    if (prefix === "xml" && namespaceUri !== XML_NAMESPACE_URI) {
      invalid(`${path}.prefix`, "must bind the xml prefix to the XML namespace");
    }
    if (prefix === "xmlns" || namespaceUri === XMLNS_NAMESPACE_URI) {
      invalid(`${path}.namespaceUri`, "must not use the XMLNS namespace for an element");
    }
  }
  return { namespaceUri, localName };
}

function validateParseErrors(value: unknown, path: string): void {
  const errors = array(value, path);
  for (let index = 0; index < errors.length; index += 1) {
    const errorPath = `${path}[${String(index)}]`;
    const source = record(errors[index], errorPath);
    if (read(source, "code", `${errorPath}.code`) !== "PARSER_ERROR") {
      invalid(`${errorPath}.code`, 'must be "PARSER_ERROR"');
    }
    string(read(source, "parseErrorId", `${errorPath}.parseErrorId`), `${errorPath}.parseErrorId`);
    string(read(source, "message", `${errorPath}.message`), `${errorPath}.message`);
    span(read(source, "span", `${errorPath}.span`), `${errorPath}.span`);
  }
}

function validateFragmentContextAttributes(
  value: unknown,
  path: string,
  htmlContext: boolean
): void {
  const attributes = array(value, path);
  const expandedNames = new Set<string>();
  for (let index = 0; index < attributes.length; index += 1) {
    const attributePath = `${path}[${String(index)}]`;
    const source = record(attributes[index], attributePath);
    const namespaceUri = read(source, "namespaceUri", `${attributePath}.namespaceUri`);
    if (namespaceUri !== null && namespaceUri !== XLINK_NAMESPACE_URI &&
        namespaceUri !== XML_NAMESPACE_URI && namespaceUri !== XMLNS_NAMESPACE_URI) {
      invalid(
        `${attributePath}.namespaceUri`,
        "must be null or the XLink, XML, or XMLNS namespace URI"
      );
    }
    const localName = string(
      read(source, "localName", `${attributePath}.localName`),
      `${attributePath}.localName`
    );
    if (!isXmlLocalName(localName) ||
        (htmlContext && namespaceUri === null && localName !== asciiLowercase(localName))) {
      invalid(`${attributePath}.localName`, "must be a normalized XML local name");
    }
    string(read(source, "value", `${attributePath}.value`), `${attributePath}.value`);
    const expandedName = `${namespaceUri ?? ""}\u0000${localName}`;
    if (expandedNames.has(expandedName)) {
      invalid(attributePath, "must have a unique namespace and local name");
    }
    expandedNames.add(expandedName);
  }
}

function pushChildren(
  children: readonly unknown[],
  path: string,
  placement: ChildPlacement,
  pending: PendingNode[]
): void {
  for (let index = children.length - 1; index >= 0; index -= 1) {
    pending.push({
      value: children[index],
      path: `${path}[${String(index)}]`,
      placement
    });
  }
}

function validateRoot(
  source: UnknownRecord,
  kind: "document" | "fragment",
  ids: Set<number>,
  pending: PendingNode[]
): void {
  nodeId(read(source, "id", "tree.id"), "tree.id", ids);
  const scriptingMode = read(source, "scriptingMode", "tree.scriptingMode");
  if (scriptingMode !== "inert" && scriptingMode !== "disabled") {
    invalid("tree.scriptingMode", 'must be "inert" or "disabled"');
  }
  validateParseErrors(read(source, "errors", "tree.errors"), "tree.errors");
  const children = array(read(source, "children", "tree.children"), "tree.children");
  if (kind === "fragment") {
    const documentMode = read(source, "documentMode", "tree.documentMode");
    if (documentMode !== "no-quirks" && documentMode !== "limited-quirks" && documentMode !== "quirks") {
      invalid("tree.documentMode", "must be a supported document mode");
    }
    if (typeof read(source, "hasFormInContextChain", "tree.hasFormInContextChain") !== "boolean") {
      invalid("tree.hasFormInContextChain", "must be a boolean");
    }
    const context = record(read(source, "context", "tree.context"), "tree.context");
    const namespaceUri = read(context, "namespaceUri", "tree.context.namespaceUri");
    if (namespaceUri !== HTML_NAMESPACE_URI && namespaceUri !== SVG_NAMESPACE_URI &&
        namespaceUri !== MATHML_NAMESPACE_URI) {
      invalid("tree.context.namespaceUri", "must be the HTML, SVG, or MathML namespace URI");
    }
    const localName = string(
      read(context, "localName", "tree.context.localName"),
      "tree.context.localName"
    );
    if (!isXmlLocalName(localName) ||
        (namespaceUri === HTML_NAMESPACE_URI && localName !== asciiLowercase(localName))) {
      invalid("tree.context.localName", "must be a normalized XML local name");
    }
    validateFragmentContextAttributes(
      read(context, "attributes", "tree.context.attributes"),
      "tree.context.attributes",
      namespaceUri === HTML_NAMESPACE_URI
    );
  }
  pushChildren(children, "tree.children", kind, pending);
}

/** Validates every serializer-visible invariant before any output is emitted. */
export function validateSerializableInput(
  value: unknown,
  operation: OperationContext
): asserts value is DocumentTree | FragmentTree | SerializableNode {
  if (isParserOwnedTree(value)) return;
  const root = record(value, "tree");
  const rootKind = read(root, "kind", "tree.kind");
  const ids = new Set<number>();
  const pending: PendingNode[] = [];
  if (rootKind === "document" || rootKind === "fragment") {
    validateRoot(root, rootKind, ids, pending);
  } else {
    pending.push({ value, path: "tree", placement: "standalone" });
  }

  const seen = new WeakMap<object, string>();
  const documentKinds = { doctypes: 0, elements: 0, elementSeen: false };
  while (pending.length > 0) {
    operation.checkpoint();
    const entry = pending.pop();
    if (entry === undefined) continue;
    const node = record(entry.value, entry.path);
    const priorPath = seen.get(node);
    if (priorPath !== undefined) {
      invalid(entry.path, `must be uniquely owned; first encountered at ${priorPath}`);
    }
    seen.set(node, entry.path);
    nodeId(read(node, "id", `${entry.path}.id`), `${entry.path}.id`, ids);
    const kind = read(node, "kind", `${entry.path}.kind`);
    if (kind === "templateContent") {
      if (entry.placement !== "template") {
        invalid(entry.path, "template content must be owned by exactly one HTML template element");
      }
      const provenance = read(node, "spanProvenance", `${entry.path}.spanProvenance`);
      if (provenance !== undefined && provenance !== "inferred") {
        invalid(`${entry.path}.spanProvenance`, 'must be "inferred" when provided');
      }
      const children = array(read(node, "children", `${entry.path}.children`), `${entry.path}.children`);
      pushChildren(children, `${entry.path}.children`, "element", pending);
      continue;
    }
    if (kind !== "element" && kind !== "text" && kind !== "comment" &&
        kind !== "processingInstruction" && kind !== "doctype") {
      invalid(`${entry.path}.kind`, "must be a supported serializable node kind");
    }
    if (entry.placement !== "standalone") {
      if (kind === "doctype" && entry.placement !== "document") {
        invalid(entry.path, "a doctype can only be a direct document child or standalone node");
      }
      if (kind === "text" && entry.placement === "document") {
        invalid(entry.path, "a text node cannot be a direct document child");
      }
    }
    if (entry.placement === "document") {
      if (kind === "doctype") {
        documentKinds.doctypes += 1;
        if (documentKinds.doctypes > 1 || documentKinds.elementSeen) {
          invalid(entry.path, "a document has at most one doctype before its element");
        }
      } else if (kind === "element") {
        documentKinds.elements += 1;
        documentKinds.elementSeen = true;
        if (documentKinds.elements > 1) invalid(entry.path, "a document has at most one element child");
      }
    }
    nodeSourceFields(node, entry.path);
    if (kind === "text" || kind === "comment") {
      string(read(node, "value", `${entry.path}.value`), `${entry.path}.value`);
      continue;
    }
    if (kind === "processingInstruction") {
      string(read(node, "target", `${entry.path}.target`), `${entry.path}.target`);
      string(read(node, "data", `${entry.path}.data`), `${entry.path}.data`);
      continue;
    }
    if (kind === "doctype") {
      const name = string(read(node, "name", `${entry.path}.name`), `${entry.path}.name`);
      if (!isHtmlElementName(name)) {
        invalid(`${entry.path}.name`, "must be safely representable as one doctype name");
      }
      const externalId = record(
        read(node, "externalId", `${entry.path}.externalId`),
        `${entry.path}.externalId`
      );
      const externalKind = read(externalId, "kind", `${entry.path}.externalId.kind`);
      if (externalKind === "public") {
        string(read(externalId, "publicId", `${entry.path}.externalId.publicId`), `${entry.path}.externalId.publicId`);
        const systemId = read(externalId, "systemId", `${entry.path}.externalId.systemId`);
        if (systemId !== null) string(systemId, `${entry.path}.externalId.systemId`);
      } else if (externalKind === "system") {
        string(read(externalId, "systemId", `${entry.path}.externalId.systemId`), `${entry.path}.externalId.systemId`);
      } else if (externalKind !== "none") {
        invalid(`${entry.path}.externalId.kind`, 'must be "none", "public", or "system"');
      }
      continue;
    }

    const identity = validateElementIdentity(node, entry.path);
    validateAttributes(
      read(node, "attributes", `${entry.path}.attributes`),
      `${entry.path}.attributes`,
      identity.namespaceUri === HTML_NAMESPACE_URI
    );
    const children = array(read(node, "children", `${entry.path}.children`), `${entry.path}.children`);
    const templateContent = read(node, "templateContent", `${entry.path}.templateContent`);
    const isTemplate = identity.namespaceUri === HTML_NAMESPACE_URI && identity.localName === "template";
    if (isTemplate) {
      if (children.length !== 0) {
        invalid(`${entry.path}.children`, "must be empty because an HTML template owns templateContent");
      }
      if (templateContent === undefined) {
        invalid(`${entry.path}.templateContent`, "must be present on an HTML template element");
      }
      pending.push({
        value: templateContent,
        path: `${entry.path}.templateContent`,
        placement: "template"
      });
    } else {
      if (templateContent !== undefined) {
        invalid(`${entry.path}.templateContent`, "is only valid on an HTML template element");
      }
      pushChildren(children, `${entry.path}.children`, "element", pending);
    }
  }
}
