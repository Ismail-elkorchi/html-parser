import assert from "node:assert/strict";
import test from "node:test";

import {
  HtmlConfigurationError,
  TEXT_CONTENT_POLICY,
  chunk,
  extractText,
  findAllByAttr,
  findAllByAttrNS,
  findAllByTagName,
  findAllByTagNameNS,
  findById,
  getAttributeValue,
  getAttributeValueNS,
  hasAttribute,
  hasAttributeNS,
  outline,
  parse,
  walk,
  walkElements
} from "../../dist/mod.js";

test("walk and walkElements are deterministic", () => {
  const { tree } = parse("<article id=\"a\"><h1>x</h1><p data-role=\"lead\">hello</p><p>world</p></article>");

  const firstWalk = [];
  walk(tree, (node, depth) => {
    firstWalk.push(`${String(depth)}:${node.kind}:${node.kind === "element" ? node.localName : ""}`);
  });

  const secondWalk = [];
  walk(tree, (node, depth) => {
    secondWalk.push(`${String(depth)}:${node.kind}:${node.kind === "element" ? node.localName : ""}`);
  });

  assert.deepEqual(firstWalk, secondWalk);

  const firstElements = [];
  walkElements(tree, (node, depth) => {
    firstElements.push(`${String(depth)}:${node.localName}`);
  });
  const secondElements = [];
  walkElements(tree, (node, depth) => {
    secondElements.push(`${String(depth)}:${node.localName}`);
  });

  assert.deepEqual(firstElements, secondElements);
  assert.ok(firstElements.length >= 3);
});

test("query helpers reject invalid JavaScript arguments with one public error category", () => {
  const { tree } = parse("<p class=x></p>");
  const element = [...findAllByTagName(tree, "p")][0];
  assert.ok(element);
  const invalidCalls = [
    () => getAttributeValue(element, 1),
    () => getAttributeValue(null, "class"),
    () => getAttributeValue({ ...element, attributes: [null] }, "class"),
    () => hasAttribute(element, 1),
    () => getAttributeValueNS(element, 1, "class"),
    () => getAttributeValueNS(element, null, 1),
    () => hasAttributeNS(element, null, 1),
    () => findAllByTagName(tree, 1),
    () => findAllByTagNameNS(tree, 1, "p"),
    () => findAllByTagNameNS(tree, "urn:test", 1),
    () => findAllByAttr(tree, 1),
    () => findAllByAttr(tree, "class", 1),
    () => findAllByAttrNS(tree, 1, "class"),
    () => findAllByAttrNS(tree, null, 1),
    () => findAllByAttrNS(tree, null, "class", 1),
    () => findById(tree, 0),
    () => findById(null, 1),
    () => walk(null, () => undefined),
    () => walk(tree, null),
    () => walkElements(tree, null),
    () => [...findAllByAttr({
      ...tree,
      children: [{ ...element, attributes: null }]
    }, "class")]
  ];
  for (const invoke of invalidCalls) {
    assert.throws(invoke, HtmlConfigurationError);
  }
});

test("all public tree traversals reject cyclic caller graphs deterministically", () => {
  const element = {
    id: 2,
    kind: "element",
    namespaceUri: "http://www.w3.org/1999/xhtml",
    localName: "div",
    attributes: [],
    children: []
  };
  element.children.push(element);
  const tree = {
    id: 1,
    kind: "fragment",
    context: {
      namespaceUri: "http://www.w3.org/1999/xhtml",
      localName: "div",
      attributes: []
    },
    scriptingMode: "inert",
    documentMode: "no-quirks",
    hasFormInContextChain: false,
    children: [element],
    errors: []
  };

  const operations = [
    () => walk(tree, () => undefined),
    () => [...findAllByTagName(tree, "div")],
    () => outline(tree),
    () => extractText(tree, {
      policy: TEXT_CONTENT_POLICY,
      maxOutputBytes: 100,
      maxTokens: 100
    }),
    () => chunk(tree)
  ];
  for (const operation of operations) {
    assert.throws(operation, HtmlConfigurationError);
  }
});

test("outline entry text uses a scalar-safe 200-byte UTF-8 prefix", () => {
  const { tree } = parse(`<h1>${"😀".repeat(100)}Z</h1>`);
  const entry = outline(tree).entries[0];
  assert.ok(entry);
  assert.equal(entry.localName, "h1");
  assert.equal(new TextEncoder().encode(entry.text).byteLength, 200);
  assert.equal(entry.text, "😀".repeat(50));
  assert.equal(/^[\uD800-\uDBFF]$/u.test(entry.text.at(-1) ?? ""), false);
});

test("bounded raw extraction and find helpers return expected nodes", () => {
  const { tree } = parse("<section id=\"root\"><h1>x</h1><p data-role=\"lead\">hello</p><p>world</p></section>");

  const sections = [...findAllByTagName(tree, "section")];
  assert.equal(sections.length, 1);

  const leads = [...findAllByAttr(tree, "data-role", "lead")];
  assert.equal(leads.length, 1);
  assert.equal(leads[0]?.kind, "element");
  assert.equal(leads[0]?.localName, "p");

  const section = sections[0];
  assert.ok(section);
  const byId = findById(tree, section.id);
  assert.equal(byId?.id, section.id);

  const sectionText = extractText(section, {
    policy: TEXT_CONTENT_POLICY,
    maxOutputBytes: 100,
    maxTokens: 100
  });
  assert.deepEqual(sectionText, {
    text: "xhelloworld",
    totalBytes: 11,
    truncated: false,
    policy: TEXT_CONTENT_POLICY
  });
});
