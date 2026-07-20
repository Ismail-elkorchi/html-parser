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
  Attribute,
  ElementNode,
  HtmlScriptingMode
} from "./types.ts";

const HTML_VOID_ELEMENT_NAMES: ReadonlySet<string> = new Set([
  "area",
  "base",
  "basefont",
  "bgsound",
  "br",
  "col",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

const LITERAL_TEXT_PARENT_NAMES: ReadonlySet<string> = new Set([
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "script",
  "style",
  "xmp"
]);

/** Escapes text using the HTML fragment serialization algorithm. */
export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/\u00a0/g, "&nbsp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escapes an attribute value using the HTML fragment serialization algorithm. */
export function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/"/g, "&quot;");
}

/** Returns the namespace-derived serialized attribute name. */
export function serializedAttributeName(attribute: Attribute): string {
  if (attribute.namespaceUri === null) return attribute.localName;
  if (attribute.namespaceUri === XML_NAMESPACE_URI) return `xml:${attribute.localName}`;
  if (attribute.namespaceUri === XMLNS_NAMESPACE_URI) {
    return attribute.localName === "xmlns" ? "xmlns" : `xmlns:${attribute.localName}`;
  }
  if (attribute.namespaceUri === XLINK_NAMESPACE_URI) return `xlink:${attribute.localName}`;
  return attribute.name;
}

/** Returns the serialized tag name for one public element. */
export function serializedElementName(element: ElementNode): string {
  if (
    element.namespaceUri === HTML_NAMESPACE_URI ||
    element.namespaceUri === SVG_NAMESPACE_URI ||
    element.namespaceUri === MATHML_NAMESPACE_URI
  ) {
    return element.localName;
  }
  return element.tagName;
}

/** Whether the element omits children and an end tag during HTML serialization. */
export function serializesAsVoid(element: ElementNode): boolean {
  return element.namespaceUri === HTML_NAMESPACE_URI &&
    HTML_VOID_ELEMENT_NAMES.has(asciiLowercase(element.localName));
}

/** Whether text below this exact parent is appended literally. */
export function serializesTextLiterally(
  parent: ElementNode | null,
  scriptingMode: HtmlScriptingMode
): boolean {
  if (parent?.namespaceUri !== HTML_NAMESPACE_URI) return false;
  const localName = asciiLowercase(parent.localName);
  return LITERAL_TEXT_PARENT_NAMES.has(localName) ||
    (localName === "noscript" && scriptingMode === "inert");
}

/** Whether literal replacement text can terminate its owning raw-text element. */
export function containsEffectiveRawTextEndTag(
  value: string,
  parent: ElementNode | null,
  scriptingMode: HtmlScriptingMode
): boolean {
  if (!serializesTextLiterally(parent, scriptingMode) || parent === null) return false;
  const localName = asciiLowercase(parent.localName);
  if (localName === "plaintext") return false;
  const escapedName = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`</${escapedName}(?:[\\t\\n\\f\\r />])`, "i").test(value);
}
