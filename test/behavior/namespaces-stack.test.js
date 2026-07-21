import assert from "node:assert/strict";
import test from "node:test";

import {
  HTML_NAMESPACE_URI,
  HtmlConfigurationError,
  MATHML_NAMESPACE_URI,
  SVG_NAMESPACE_URI,
  XLINK_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
  TEXT_CONTENT_POLICY,
  VISIBLE_TEXT_HTML_POLICY,
  chunk,
  computePatch,
  extractText,
  findAllByAttr,
  findAllByAttrNS,
  findAllByTagName,
  findAllByTagNameNS,
  getAttributeValue,
  getAttributeValueNS,
  hasAttribute,
  hasAttributeNS,
  iterateText,
  outline,
  parse,
  serialize,
  walk
} from "../../dist/mod.js";

function only(iterable) {
  const values = [...iterable];
  assert.equal(values.length, 1);
  return values[0];
}

function rawText(input) {
  return extractText(input, {
    policy: TEXT_CONTENT_POLICY,
    maxOutputBytes: 100_000,
    maxTokens: 10_000
  }).text;
}

function visibleTextValue(input) {
  return extractText(input, {
    policy: VISIBLE_TEXT_HTML_POLICY,
    maxOutputBytes: 100_000,
    maxTokens: 10_000,
    maxFallbackInputBytes: 100_000,
    maxFallbackNodes: 10_000
  }).text;
}

function visibleTokens(input) {
  return [...iterateText(input, {
    policy: VISIBLE_TEXT_HTML_POLICY,
    maxOutputBytes: 100_000,
    maxTokens: 10_000,
    maxFallbackInputBytes: 100_000,
    maxFallbackNodes: 10_000
  })];
}

test("tree nodes retain namespace identity and adjusted foreign attributes", () => {
  const html = [
    "<main DATA-ID=one>",
    "<svg xml:lang=fr xmlns:xlink=urn:test xlink:href=icon>",
    "<title>svg title</title>",
    "<foreignObject><DIV DATA-ID=two>html island</DIV></foreignObject>",
    "</svg>",
    "<math><mi>x</mi></math>",
    "</main>"
  ].join("");
  const { tree } = parse(html, { captureSpans: true });

  const main = only(findAllByTagName(tree, "MAIN"));
  assert.equal(main.namespaceUri, HTML_NAMESPACE_URI);
  assert.equal(main.localName, "main");
  assert.equal(getAttributeValue(main, "DATA-ID"), "one");
  assert.equal(hasAttribute(main, "data-id"), true);

  const svg = only(findAllByTagNameNS(tree, SVG_NAMESPACE_URI, "svg"));
  const svgTitle = only(findAllByTagNameNS(tree, SVG_NAMESPACE_URI, "title"));
  const math = only(findAllByTagNameNS(tree, MATHML_NAMESPACE_URI, "math"));
  assert.equal(svgTitle.localName, "title");
  assert.equal(math.localName, "math");
  assert.equal([...findAllByTagName(tree, "title")].length, 0);

  const expectedAttributes = [
    [XML_NAMESPACE_URI, "lang", "fr"],
    [XMLNS_NAMESPACE_URI, "xlink", "urn:test"],
    [XLINK_NAMESPACE_URI, "href", "icon"]
  ];
  assert.deepEqual(
    svg.attributes.map((attribute) => [
      attribute.namespaceUri,
      attribute.localName,
      attribute.value
    ]),
    expectedAttributes
  );
  assert.equal(getAttributeValue(svg, "xlink:href"), undefined);
  assert.equal(getAttributeValueNS(svg, XLINK_NAMESPACE_URI, "href"), "icon");
  assert.equal(hasAttributeNS(svg, XML_NAMESPACE_URI, "lang"), true);
  assert.equal([...findAllByAttr(tree, "xlink:href")].length, 0);
  assert.equal(only(findAllByAttrNS(tree, XLINK_NAMESPACE_URI, "href", "icon")), svg);

  const xlink = svg.attributes.find((attribute) =>
    attribute.namespaceUri === XLINK_NAMESPACE_URI && attribute.localName === "href"
  );
  assert.ok(xlink?.span);
  assert.equal(html.slice(xlink.span.start, xlink.span.end), "xlink:href=icon");

});

test("doctype external identifiers preserve missing and explicit empty states", () => {
  const cases = [
    ["<!doctype html>", { kind: "none" }, "<!DOCTYPE html>"],
    ["<!doctype html PUBLIC \"pub\">", { kind: "public", publicId: "pub", systemId: null }, "<!DOCTYPE html PUBLIC \"pub\">"],
    ["<!doctype html PUBLIC \"\" \"\">", { kind: "public", publicId: "", systemId: "" }, "<!DOCTYPE html PUBLIC \"\" \"\">"],
    ["<!doctype html SYSTEM \"\">", { kind: "system", systemId: "" }, "<!DOCTYPE html SYSTEM \"\">"],
    ["<!doctype html SYSTEM \"sys\">", { kind: "system", systemId: "sys" }, "<!DOCTYPE html SYSTEM \"sys\">"],
    ["<!doctype html PUBLIC \"pub\" \"sys\">", { kind: "public", publicId: "pub", systemId: "sys" }, "<!DOCTYPE html PUBLIC \"pub\" \"sys\">"]
  ];

  for (const [input, expectedExternalId, expectedPrefix] of cases) {
    const { tree } = parse(input);
    const doctype = tree.children.find((node) => node.kind === "doctype");
    assert.ok(doctype);
    assert.deepEqual(doctype.externalId, expectedExternalId);
    const output = serialize(tree);
    assert.ok(output.startsWith(expectedPrefix));
    const { tree: reparsed } = parse(output);
    assert.deepEqual(
      reparsed.children.find((node) => node.kind === "doctype")?.externalId,
      expectedExternalId
    );
  }

  assert.throws(
    () => serialize({
      id: 1,
      kind: "doctype",
      name: "html",
      externalId: { kind: "system", systemId: "both\"and'" }
    }),
    HtmlConfigurationError
  );
});

test("foreign elements named like HTML void elements retain children and end tags", () => {
  const output = serialize(parse("<svg><source><title>x</title></source><param>y</param></svg>").tree);
  assert.match(output, /<svg><source><title>x<\/title><\/source><param>y<\/param><\/svg>/);
});

test("captured spans use decoded UTF-16 offsets and inferred nodes have no span", () => {
  const html = "😀<p A=1 disabled>x</p>";
  const { tree } = parse(html, { captureSpans: true });
  const paragraph = only(findAllByTagName(tree, "p"));
  assert.ok(paragraph.span);
  assert.equal(paragraph.span.start, 2);
  assert.equal(html.slice(paragraph.span.start, paragraph.span.end), "<p A=1 disabled>x</p>");
  assert.deepEqual(
    paragraph.attributes.map((attribute) => html.slice(attribute.span.start, attribute.span.end)),
    ["A=1", "disabled"]
  );
  const htmlElement = only(findAllByTagName(tree, "html"));
  assert.equal(htmlElement.spanProvenance, "inferred");
  assert.equal(htmlElement.span, undefined);
});

test("deep parsed and caller-built trees remain stack-safe across the public surface", () => {
  const depth = 5_000;
  const input = `${"<div>".repeat(depth)}x${"</div>".repeat(depth)}`;
  const { tree: parsed } = parse(input, {
    budgets: {
      maxInputBytes: input.length,
      maxDecodedUtf8Bytes: input.length,
      maxNodes: depth + 8,
      maxDepth: depth + 8
    }
  });
  assert.equal([...findAllByTagName(parsed, "div")].length, depth);
  assert.equal(rawText(parsed), "x");
  assert.equal(visibleTextValue(parsed), "x");
  assert.equal(visibleTokens(parsed).length, 1);
  assert.equal(serialize(parsed).includes("x"), true);
  assert.equal(outline(parsed).entries.length, 0);
  let visited = 0;
  walk(parsed, () => {
    visited += 1;
  });
  assert.equal(visited, depth + 4);
  assert.equal(chunk(parsed, { maxChars: 100_000, maxNodes: 10_000, maxBytes: 100_000 }).length, 1);

  let child = {
    id: 1,
    kind: "text",
    value: "leaf"
  };
  for (let index = 0; index < depth; index += 1) {
    child = {
      id: index + 2,
      kind: "element",
      namespaceUri: HTML_NAMESPACE_URI,
      localName: "div",
      attributes: [],
      children: [child]
    };
  }
  const manual = { id: depth + 2, kind: "document", children: [child], errors: [] };
  assert.equal(rawText(manual), "leaf");
  assert.equal(visibleTextValue(manual), "leaf");
  assert.equal(serialize(manual).includes("leaf"), true);
  assert.equal([...findAllByTagName(manual, "div")].length, depth);
  assert.equal(chunk(manual, { maxChars: 100_000, maxNodes: 10_000, maxBytes: 100_000 }).length, 1);
});

test("deep public serialization and patch indexing use explicit stacks", () => {
  const depth = 3_200;
  const input = `${"<div>".repeat(depth)}x${"</div>".repeat(depth)}`;
  const parsed = parse(input, { captureSpans: true, sourceRetention: "text" });
  let textNode = null;
  walk(parsed.tree, (node) => {
    if (node.kind === "text") {
      textNode = node;
    }
  });
  assert.ok(textNode);
  const plan = computePatch(parsed, [{ kind: "replaceText", target: textNode.id, value: "y" }]);
  assert.equal(plan.steps.some((step) => step.kind === "insert" && step.text === "y"), true);
});
