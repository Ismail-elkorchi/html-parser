/** Namespaces used by HTML tree construction. */
export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
export const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
export const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
export const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
export const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

/** Namespace identities that the HTML parser can assign to elements. */
export type HtmlElementNamespaceUri =
  | typeof HTML_NAMESPACE
  | typeof MATHML_NAMESPACE
  | typeof SVG_NAMESPACE;

/** Namespace identities that the HTML parser can assign to attributes. */
export type HtmlAttributeNamespaceUri =
  | typeof XLINK_NAMESPACE
  | typeof XML_NAMESPACE
  | typeof XMLNS_NAMESPACE
  | null;
