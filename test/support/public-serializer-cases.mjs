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
let nextNodeId = 1;

function text(value) {
  return { id: nextNodeId++, kind: "text", value };
}

function element(namespaceUri, localName, children = [], attributes = []) {
  return {
    id: nextNodeId++,
    kind: "element",
    namespaceUri,
    localName,
    attributes,
    children
  };
}

function attribute(namespaceUri, localName, value) {
  return { namespaceUri, localName, value };
}

function htmlElement(localName, children = [], attributes = []) {
  return element(HTML_NAMESPACE_URI, localName, children, attributes);
}

function literalTextCase(localName) {
  return {
    id: `literal-text/${localName}`,
    input: () => htmlElement(localName, [text(DATA)]),
    expected: `<${localName}>${DATA}</${localName}>`
  };
}

function escapedTextCase(id, namespaceUri, localName) {
  return {
    id,
    input: () => element(namespaceUri, localName, [text(DATA)]),
    expected: `<${localName}>&lt;&amp;&gt;&nbsp;</${localName}>`
  };
}

function voidCase(localName) {
  return {
    id: `void/${localName}`,
    input: () => htmlElement(localName),
    expected: `<${localName}>`
  };
}

export const PUBLIC_SERIALIZER_CASES = Object.freeze([
  ...["script", "style", "xmp", "iframe", "noembed", "noframes", "plaintext", "noscript"]
    .map(literalTextCase),
  {
    id: "noscript/disabled",
    input: () => htmlElement("noscript", [text(DATA)]),
    options: { scriptingMode: "disabled" },
    expected: "<noscript>&lt;&amp;&gt;&nbsp;</noscript>"
  },
  escapedTextCase("escaped/title", HTML_NAMESPACE_URI, "title"),
  escapedTextCase("escaped/textarea", HTML_NAMESPACE_URI, "textarea"),
  escapedTextCase("escaped/ordinary", HTML_NAMESPACE_URI, "p"),
  escapedTextCase("escaped/svg-script", SVG_NAMESPACE_URI, "script"),
  escapedTextCase("escaped/mathml-style", MATHML_NAMESPACE_URI, "style"),
  {
    id: "escaped/root-text",
    input: () => text(DATA),
    expected: "&lt;&amp;&gt;&nbsp;"
  },
  {
    id: "attributes/ordinary",
    input: () => htmlElement("p", [], [
      attribute(null, "data-x", `${DATA}"`)
    ]),
    expected: "<p data-x=\"&lt;&amp;&gt;&nbsp;&quot;\"></p>"
  },
  {
    id: "attributes/known-namespaces",
    input: () => element(SVG_NAMESPACE_URI, "svg", [], [
      attribute(XML_NAMESPACE_URI, "lang", "en"),
      attribute(XMLNS_NAMESPACE_URI, "svg", "urn:svg"),
      attribute(XMLNS_NAMESPACE_URI, "xmlns", "urn:default"),
      attribute(XLINK_NAMESPACE_URI, "href", "icon")
    ]),
    expected: "<svg xml:lang=\"en\" xmlns:svg=\"urn:svg\" xmlns=\"urn:default\" xlink:href=\"icon\"></svg>"
  },
  {
    id: "names/known-element-namespace",
    input: () => element(SVG_NAMESPACE_URI, "linearGradient"),
    expected: "<linearGradient></linearGradient>"
  },
  ...["area", "base", "basefont", "bgsound", "br", "col", "embed", "frame", "hr", "img",
    "input", "keygen", "link", "meta", "param", "source", "track", "wbr"].map(voidCase),
  {
    id: "template/nested-script",
    input: () => {
      const script = htmlElement("script", [text(DATA)]);
      const template = htmlElement("template");
      return {
        ...template,
        templateContent: {
          id: nextNodeId++,
          kind: "templateContent",
          children: [script],
          spanProvenance: "inferred"
        }
      };
    },
    expected: `<template><script>${DATA}</script></template>`
  },
  {
    id: "template/direct-text",
    input: () => {
      const template = htmlElement("template");
      return {
        ...template,
        templateContent: {
          id: nextNodeId++,
          kind: "templateContent",
          children: [text(DATA)],
          spanProvenance: "inferred"
        }
      };
    },
    expected: "<template>&lt;&amp;&gt;&nbsp;</template>"
  },
  {
    id: "node/comment",
    input: () => ({
      id: nextNodeId++,
      kind: "comment",
      value: "data"
    }),
    expected: "<!--data-->"
  },
  {
    id: "node/processing-instruction",
    input: () => ({
      id: nextNodeId++,
      kind: "processingInstruction",
      target: "build",
      data: "release"
    }),
    expected: "<?build release?>"
  },
  {
    id: "doctype/lossless-product-extension",
    input: () => ({
      id: nextNodeId++,
      kind: "doctype",
      name: "html",
      externalId: { kind: "public", publicId: "pub", systemId: "sys" }
    }),
    expected: "<!DOCTYPE html PUBLIC \"pub\" \"sys\">"
  }
]);

export function runPublicSerializerCase(testCase) {
  nextNodeId = 1;
  return serialize(testCase.input(), testCase.options ?? {});
}
