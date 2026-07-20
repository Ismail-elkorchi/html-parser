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

import type {
  HtmlFragmentContext,
  HtmlFragmentContextAttribute,
  HtmlFragmentContextInput
} from "./types.ts";
type UnknownRecord = Readonly<Record<PropertyKey, unknown>>;

interface EngineFragmentContextAttribute {
  readonly namespaceUri: HtmlFragmentContextAttribute["namespaceUri"];
  readonly prefix: string | null;
  readonly localName: string;
  readonly qualifiedName: string;
  readonly value: string;
}

interface EngineFragmentContext {
  readonly namespaceUri: HtmlFragmentContext["namespaceUri"];
  readonly localName: string;
  readonly attributes: readonly EngineFragmentContextAttribute[];
}

const CONTEXT_KEYS = new Set<PropertyKey>(["namespaceUri", "localName", "attributes"]);
const ATTRIBUTE_KEYS = new Set<PropertyKey>(["namespaceUri", "localName", "value"]);

function invalid(option: string, expected: string): never {
  throw new HtmlConfigurationError(option, "INVALID_VALUE", expected);
}

function closedRecord(
  value: unknown,
  option: string,
  allowedKeys: ReadonlySet<PropertyKey>
): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(option, "must be a plain object");
  }
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    invalid(option, "must expose readable own keys");
  }
  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      throw new HtmlConfigurationError(
        `${option}.${String(key)}`,
        "UNKNOWN_OPTION",
        `must be one of ${[...allowedKeys].map(String).join(", ")}`
      );
    }
  }
  return value as UnknownRecord;
}

function read(record: UnknownRecord, key: PropertyKey, option: string): unknown {
  try {
    return record[key];
  } catch {
    invalid(option, "must be a readable data property");
  }
}

function localName(value: unknown, option: string): string {
  if (typeof value !== "string") invalid(option, "must be a non-empty local name");
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.includes(":")) {
    invalid(option, 'must be a non-empty local name without a namespace prefix or ":"');
  }
  return normalized;
}

function normalizeAttribute(value: unknown, index: number): HtmlFragmentContextAttribute {
  const option = `context.attributes[${String(index)}]`;
  const record = closedRecord(value, option, ATTRIBUTE_KEYS);
  const namespaceUri = read(record, "namespaceUri", `${option}.namespaceUri`);
  if (
    namespaceUri !== null &&
    namespaceUri !== XLINK_NAMESPACE_URI &&
    namespaceUri !== XML_NAMESPACE_URI &&
    namespaceUri !== XMLNS_NAMESPACE_URI
  ) {
    invalid(
      `${option}.namespaceUri`,
      "must be null or the XLink, XML, or XMLNS namespace URI"
    );
  }
  const valueField = read(record, "value", `${option}.value`);
  if (typeof valueField !== "string") invalid(`${option}.value`, "must be a string");
  return Object.freeze({
    namespaceUri,
    localName: localName(read(record, "localName", `${option}.localName`), `${option}.localName`),
    value: valueField
  });
}

/** Validates and snapshots the semantic public fragment context. */
export function normalizeFragmentContext(value: HtmlFragmentContextInput): HtmlFragmentContext {
  const record = closedRecord(value, "context", CONTEXT_KEYS);
  const namespaceUri = read(record, "namespaceUri", "context.namespaceUri");
  if (
    namespaceUri !== HTML_NAMESPACE_URI &&
    namespaceUri !== SVG_NAMESPACE_URI &&
    namespaceUri !== MATHML_NAMESPACE_URI
  ) {
    invalid("context.namespaceUri", "must be the HTML, SVG, or MathML namespace URI");
  }
  const rawLocalName = localName(read(record, "localName", "context.localName"), "context.localName");
  const attributesValue = read(record, "attributes", "context.attributes");
  if (attributesValue !== undefined && !Array.isArray(attributesValue)) {
    invalid("context.attributes", "must be an array when provided");
  }
  const rawAttributes = (attributesValue ?? []) as readonly unknown[];
  const attributes: HtmlFragmentContextAttribute[] = [];
  const expandedNames = new Set<string>();
  for (let index = 0; index < rawAttributes.length; index += 1) {
    if (!Object.hasOwn(rawAttributes, index)) {
      invalid(`context.attributes[${String(index)}]`, "must be an attribute object");
    }
    const attribute = normalizeAttribute(rawAttributes[index], index);
    const expandedName = `${attribute.namespaceUri ?? ""}\u0000${attribute.localName}`;
    if (expandedNames.has(expandedName)) {
      invalid(`context.attributes[${String(index)}]`, "must have a unique namespace and local name");
    }
    expandedNames.add(expandedName);
    attributes.push(attribute);
  }
  return Object.freeze({
    namespaceUri,
    localName: namespaceUri === HTML_NAMESPACE_URI ? asciiLowercase(rawLocalName) : rawLocalName,
    attributes: Object.freeze(attributes)
  });
}

function engineAttribute(attribute: HtmlFragmentContextAttribute): EngineFragmentContextAttribute {
  const prefix = attribute.namespaceUri === XLINK_NAMESPACE_URI
    ? "xlink"
    : attribute.namespaceUri === XML_NAMESPACE_URI
      ? "xml"
      : attribute.namespaceUri === XMLNS_NAMESPACE_URI && attribute.localName !== "xmlns"
        ? "xmlns"
        : null;
  return Object.freeze({
    namespaceUri: attribute.namespaceUri,
    prefix,
    localName: attribute.localName,
    qualifiedName: prefix === null ? attribute.localName : `${prefix}:${attribute.localName}`,
    value: attribute.value
  });
}

/** Derives the engine-only qualified attribute representation. */
export function toEngineFragmentContext(context: HtmlFragmentContext): EngineFragmentContext {
  return Object.freeze({
    namespaceUri: context.namespaceUri,
    localName: context.localName,
    attributes: Object.freeze(context.attributes.map(engineAttribute))
  });
}
