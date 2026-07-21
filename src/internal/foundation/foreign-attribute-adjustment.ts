interface ForeignAttributeAdjustment {
  readonly namespaceUri:
    | "http://www.w3.org/1999/xlink"
    | "http://www.w3.org/XML/1998/namespace"
    | "http://www.w3.org/2000/xmlns/";
  readonly prefix: string | null;
  readonly localName: string;
}

const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

function adjustment(
  namespaceUri: ForeignAttributeAdjustment["namespaceUri"],
  prefix: string | null,
  localName: string
): ForeignAttributeAdjustment {
  return Object.freeze({ namespaceUri, prefix, localName });
}

const FOREIGN_ATTRIBUTE_ADJUSTMENTS = new Map<string, ForeignAttributeAdjustment>([
  ["xlink:actuate", adjustment(XLINK_NAMESPACE, "xlink", "actuate")],
  ["xlink:arcrole", adjustment(XLINK_NAMESPACE, "xlink", "arcrole")],
  ["xlink:href", adjustment(XLINK_NAMESPACE, "xlink", "href")],
  ["xlink:role", adjustment(XLINK_NAMESPACE, "xlink", "role")],
  ["xlink:show", adjustment(XLINK_NAMESPACE, "xlink", "show")],
  ["xlink:title", adjustment(XLINK_NAMESPACE, "xlink", "title")],
  ["xlink:type", adjustment(XLINK_NAMESPACE, "xlink", "type")],
  ["xml:lang", adjustment(XML_NAMESPACE, "xml", "lang")],
  ["xml:space", adjustment(XML_NAMESPACE, "xml", "space")],
  ["xmlns", adjustment(XMLNS_NAMESPACE, null, "xmlns")],
  ["xmlns:xlink", adjustment(XMLNS_NAMESPACE, "xmlns", "xlink")]
]);

/** Returns the namespace adjustment performed for attribute syntax on foreign elements. */
export function foreignAttributeAdjustment(name: string): ForeignAttributeAdjustment | undefined {
  return FOREIGN_ATTRIBUTE_ADJUSTMENTS.get(name);
}
