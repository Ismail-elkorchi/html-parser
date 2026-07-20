import {
  HTML_NAMESPACE_URI,
  MATHML_NAMESPACE_URI,
  SVG_NAMESPACE_URI,
  XLINK_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
  serialize
} from "../../dist/mod.js";

const DATA = "<&>\u00a0";

export const WPT_OUTER_HTML_ELEMENTS = Object.freeze([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base", "bdi", "bdo",
  "blockquote", "body", "br", "button", "canvas", "caption", "cite", "code", "col", "colgroup",
  "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt", "em", "embed",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "head", "header", "hr", "html", "i", "iframe", "img", "input", "ins", "kbd", "label", "legend",
  "li", "link", "main", "map", "mark", "menu", "meta", "meter", "nav", "noscript", "object", "ol",
  "optgroup", "option", "output", "p", "param", "pre", "progress", "q", "rp", "rt", "ruby", "s",
  "samp", "script", "search", "section", "select", "slot", "small", "source", "span", "strong", "style",
  "sub", "sup", "summary", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead",
  "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr"
]);
export const WPT_OUTER_HTML_VOID_ELEMENTS = Object.freeze([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
  "track", "wbr"
]);
const WPT_HTML_VOID_ELEMENT_SET = new Set(WPT_OUTER_HTML_VOID_ELEMENTS);

const source = (file, test) => Object.freeze({ file, test });
const text = (value) => Object.freeze({ type: "text", value });
const comment = (value) => Object.freeze({ type: "comment", value });
const processingInstruction = (target, data) => Object.freeze({
  type: "processingInstruction",
  target,
  data
});
const attribute = (namespaceUri, prefix, localName, qualifiedName, value) => Object.freeze({
  namespaceUri,
  prefix,
  localName,
  qualifiedName,
  value
});
const element = (
  localName,
  children = [],
  namespaceUri = HTML_NAMESPACE_URI,
  attributes = [],
  options = {}
) => Object.freeze({
  type: "element",
  namespaceUri,
  localName,
  qualifiedName: options.qualifiedName ?? localName,
  attributes: Object.freeze(attributes),
  children: Object.freeze(children),
  ...(options.templateChildren === undefined
    ? {}
    : { templateChildren: Object.freeze(options.templateChildren) })
});

function publicNode(descriptor, ids) {
  if (descriptor.type === "text") {
    return { id: ids.next++, kind: "text", value: descriptor.value, spanProvenance: "none" };
  }
  if (descriptor.type === "comment") {
    return { id: ids.next++, kind: "comment", value: descriptor.value, spanProvenance: "none" };
  }
  if (descriptor.type === "processingInstruction") {
    return {
      id: ids.next++,
      kind: "processingInstruction",
      target: descriptor.target,
      data: descriptor.data,
      spanProvenance: "none"
    };
  }
  if (descriptor.type === "doctype") {
    return {
      id: ids.next++,
      kind: "doctype",
      name: descriptor.name,
      externalId: descriptor.externalId,
      spanProvenance: "none"
    };
  }
  const node = {
    id: ids.next++,
    kind: "element",
    namespaceUri: descriptor.namespaceUri,
    prefix: descriptor.qualifiedName.includes(":")
      ? descriptor.qualifiedName.slice(0, descriptor.qualifiedName.indexOf(":"))
      : null,
    localName: descriptor.localName,
    tagName: descriptor.qualifiedName,
    attributes: descriptor.attributes.map((entry) => ({
      namespaceUri: entry.namespaceUri,
      prefix: entry.prefix,
      localName: entry.localName,
      name: entry.qualifiedName,
      value: entry.value
    })),
    children: descriptor.children.map((child) => publicNode(child, ids)),
    spanProvenance: "none"
  };
  if (descriptor.templateChildren !== undefined) {
    node.templateContent = {
      id: ids.next++,
      kind: "templateContent",
      children: descriptor.templateChildren.map((child) => publicNode(child, ids)),
      spanProvenance: "inferred"
    };
  }
  return node;
}

function qualificationCase(id, descriptor, expected, features, options = {}) {
  return Object.freeze({
    id,
    descriptor,
    expected,
    features: Object.freeze(features),
    serializationOptions: Object.freeze(options.serializationOptions ?? {}),
    browserEnvironment: options.browserEnvironment ?? "inert",
    browserApplicable: options.browserApplicable ?? true,
    acceptedBrowserOutputs: Object.freeze(options.acceptedBrowserOutputs ?? {}),
    source: options.source
  });
}

function literalCase(localName, sourceTest) {
  return qualificationCase(
    `raw/${localName}`,
    element(localName, [text(DATA)]),
    `<${localName}>${DATA}</${localName}>`,
    [localName],
    { source: source("serializing.html", sourceTest) }
  );
}

function voidCase(localName) {
  return qualificationCase(
    `void/${localName}`,
    element(localName, [element("a", [text("ignored")])]),
    `<${localName}>`,
    ["void-elements"],
    { source: source("outerHTML.html", `void outerHTML: ${localName}`) }
  );
}

const templateTree = element("template", [], HTML_NAMESPACE_URI, [], {
  templateChildren: [
    element("table", [
      element("tbody", [element("tr", [element("td")])])
    ])
  ]
});

export const PUBLIC_SERIALIZATION_QUALIFICATION_CASES = Object.freeze([
  qualificationCase(
    "ordinary/empty-element",
    element("span"),
    "<span></span>",
    ["ordinary"],
    { source: source("serializing.html", "outerHTML 0") }
  ),
  ...WPT_OUTER_HTML_ELEMENTS.map((localName) => qualificationCase(
    `wpt/outerHTML/${localName}`,
    element(localName),
    WPT_HTML_VOID_ELEMENT_SET.has(localName) ? `<${localName}>` : `<${localName}></${localName}>`,
    ["element-inventory"],
    { source: source("outerHTML.html", `Node for ${localName}`) }
  )),
  qualificationCase(
    "ordinary/text-escaping",
    element("span", [text(`${DATA}"`)]),
    "<span>&lt;&amp;&gt;&nbsp;\"</span>",
    ["ordinary", "text-escaping"],
    { source: source("serializing.html", "text escaping rows") }
  ),
  qualificationCase(
    "ordinary/attribute-escaping",
    element("a", [], HTML_NAMESPACE_URI, [
      attribute(null, null, "data-x", "data-x", `${DATA}"`)
    ]),
    "<a data-x=\"&lt;&amp;&gt;&nbsp;&quot;\"></a>",
    ["ordinary", "attribute-escaping"],
    { source: source("serializing-lt-gt.html", "innerHTML and outerHTML") }
  ),
  ...[
    ["script", "raw script"],
    ["style", "raw style"],
    ["xmp", "raw xmp"],
    ["iframe", "raw iframe"],
    ["noembed", "raw noembed"],
    ["noframes", "raw noframes"],
    ["noscript", "raw noscript"]
  ].map(([localName, sourceTest]) => literalCase(localName, sourceTest)),
  qualificationCase(
    "raw/plaintext",
    element("plaintext", [text(DATA)]),
    `<plaintext>${DATA}</plaintext>`,
    ["plaintext"],
    {}
  ),
  qualificationCase(
    "noscript/disabled",
    element("noscript", [text(DATA)]),
    "<noscript>&lt;&amp;&gt;&nbsp;</noscript>",
    ["noscript-disabled"],
    {
      serializationOptions: { scriptingMode: "disabled" },
      browserEnvironment: "disabled",
      source: source("escaping.html", "DOMParser.parseFromString")
    }
  ),
  qualificationCase(
    "rcdata/title",
    element("title", [text(DATA)]),
    "<title>&lt;&amp;&gt;&nbsp;</title>",
    ["title"],
    {}
  ),
  qualificationCase(
    "rcdata/textarea",
    element("textarea", [text(DATA)]),
    "<textarea>&lt;&amp;&gt;&nbsp;</textarea>",
    ["textarea"],
    { source: source("initial-linefeed-pre.html", "textarea innerHTML") }
  ),
  ...["pre", "textarea", "listing"].map((localName) => qualificationCase(
    `initial-linefeed/${localName}`,
    element(localName, [text("\nx")]),
    `<${localName}>\nx</${localName}>`,
    ["initial-linefeed"],
    { source: source("initial-linefeed-pre.html", `${localName}2`) }
  )),
  qualificationCase(
    "foreign/svg",
    element("svg", [
      element("script", [text(DATA)], SVG_NAMESPACE_URI)
    ], SVG_NAMESPACE_URI, [
      attribute(XLINK_NAMESPACE_URI, "xlink", "href", "xlink:href", "a"),
      attribute(XML_NAMESPACE_URI, "xml", "lang", "xml:lang", "en"),
      attribute(XMLNS_NAMESPACE_URI, "xmlns", "svg", "xmlns:svg", "urn:svg")
    ]),
    "<svg xlink:href=\"a\" xml:lang=\"en\" xmlns:svg=\"urn:svg\"><script>&lt;&amp;&gt;&nbsp;</script></svg>",
    ["svg", "namespaced-attributes"],
    { source: source("serializing.html", "SVG and known namespaced attributes") }
  ),
  qualificationCase(
    "foreign/mathml",
    element("math", [element("style", [text(DATA)], MATHML_NAMESPACE_URI)], MATHML_NAMESPACE_URI),
    "<math><style>&lt;&amp;&gt;&nbsp;</style></math>",
    ["mathml"],
    {}
  ),
  qualificationCase(
    "foreign/other-namespaced-attribute",
    element("svg", [], SVG_NAMESPACE_URI, [
      attribute("urn:example", "p", "attr", "p:attr", "v")
    ]),
    "<svg p:attr=\"v\"></svg>",
    ["namespaced-attributes"],
    { source: source("template.html", "non-standard namespaced template attribute") }
  ),
  qualificationCase(
    "foreign/cdata-as-text",
    element("svg", [text("<img>")], SVG_NAMESPACE_URI, [
      attribute(XMLNS_NAMESPACE_URI, null, "xmlns", "xmlns", SVG_NAMESPACE_URI)
    ]),
    `<svg xmlns="${SVG_NAMESPACE_URI}">&lt;img&gt;</svg>`,
    ["svg", "cdata-as-text"],
    { source: source("serializing-cdata-in-html-document.html", "adopted SVG CDATA") }
  ),
  qualificationCase(
    "template/tree",
    templateTree,
    "<template><table><tbody><tr><td></td></tr></tbody></table></template>",
    ["template"],
    { source: source("template.html", "template contents") }
  ),
  ...[
    "area", "base", "basefont", "bgsound", "br", "col", "embed", "frame", "hr", "img",
    "input", "keygen", "link", "meta", "param", "source", "track", "wbr"
  ].map(voidCase),
  qualificationCase(
    "node/comment",
    comment("data"),
    "<!--data-->",
    ["comments"],
    { source: source("serializing.html", "comment") }
  ),
  qualificationCase(
    "node/processing-instruction-empty",
    processingInstruction("target", ""),
    "<?target ?>",
    ["processing-instructions"],
    {
      source: source("processing-instructions.html", "PI with empty data"),
      acceptedBrowserOutputs: {
        firefox: Object.freeze({
          output: "<?target >",
          reason: "Firefox omits the question mark required by the pinned WPT expectation"
        })
      }
    }
  ),
  qualificationCase(
    "node/processing-instruction-data",
    processingInstruction("target", "data"),
    "<?target data?>",
    ["processing-instructions"],
    {
      source: source("processing-instructions.html", "PI with non-empty data"),
      acceptedBrowserOutputs: {
        firefox: Object.freeze({
          output: "<?target data>",
          reason: "Firefox omits the question mark required by the pinned WPT expectation"
        })
      }
    }
  ),
  qualificationCase(
    "product/doctype-external-identifiers",
    Object.freeze({
      type: "doctype",
      name: "html",
      externalId: Object.freeze({ kind: "public", publicId: "pub", systemId: "sys" })
    }),
    "<!DOCTYPE html PUBLIC \"pub\" \"sys\">",
    ["doctype-extension"],
    { browserApplicable: false }
  ),
  qualificationCase(
    "classified/raw-effective-end-tag",
    element("script", [text("a</script>b")]),
    "<script>a</script>b</script>",
    ["script"],
    { source: source("serializing.html", "non-roundtripping raw text permitted by standard") }
  )
]);

export const REQUIRED_SERIALIZATION_FEATURES = Object.freeze([
  "script", "style", "xmp", "iframe", "noembed", "noframes", "plaintext",
  "noscript", "noscript-disabled", "title", "textarea", "svg", "mathml",
  "template", "namespaced-attributes", "ordinary", "text-escaping",
  "attribute-escaping", "void-elements", "comments", "processing-instructions",
  "doctype-extension", "initial-linefeed", "cdata-as-text", "element-inventory"
]);

export const WPT_SERIALIZING_OUTER_EXPECTATIONS = Object.freeze([
  "<span></span>",
  "<span><a></a></span>",
  "<span><a b=\"c\"></a></span>",
  "<span><a b=\"c\"></a></span>",
  "<span><a b=\"&amp;\"></a></span>",
  "<span><a b=\"&nbsp;\"></a></span>",
  "<span><a b=\"&quot;\"></a></span>",
  "<span><a b=\"&lt;\"></a></span>",
  "<span><a b=\"&gt;\"></a></span>",
  "<span><a href=\"javascript:&quot;&lt;&gt;&quot;\"></a></span>",
  "<span><svg xlink:href=\"a\"></svg></span>",
  "<span><svg xmlns:svg=\"test\"></svg></span>",
  "<span>a</span>",
  "<span>&amp;</span>",
  "<span>&nbsp;</span>",
  "<span>&lt;</span>",
  "<span>&gt;</span>",
  "<span>\"</span>",
  "<span><style><&></style></span>",
  "<span><script type=\"test\"><&></script></span>",
  "<script type=\"test\"><&></script>",
  "<span><xmp><&></xmp></span>",
  "<span><iframe><&></iframe></span>",
  "<span><noembed><&></noembed></span>",
  "<span><noframes><&></noframes></span>",
  "<span><noscript><&></noscript></span>",
  "<span><!--data--></span>",
  "<span><a><b><c></c></b><d>e</d><f><g>h</g></f></a></span>",
  "<span b=\"c\"></span>"
]);

export function createPublicSerializationNode(descriptor) {
  return publicNode(descriptor, { next: 100000 });
}

export function runPublicSerializationQualificationCase(testCase) {
  return serialize(createPublicSerializationNode(testCase.descriptor), testCase.serializationOptions);
}
