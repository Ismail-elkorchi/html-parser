import assert from "node:assert/strict";
import test from "node:test";

import {
  HTML_NAMESPACE_URI,
  HtmlConfigurationError,
  SVG_NAMESPACE_URI,
  serialize
} from "../../dist/mod.js";
import {
  PUBLIC_SERIALIZER_CASES,
  runPublicSerializerCase
} from "../support/public-serializer-cases.mjs";

for (const testCase of PUBLIC_SERIALIZER_CASES) {
  test(`public serializer: ${testCase.id}`, () => {
    assert.equal(runPublicSerializerCase(testCase), testCase.expected);
  });
}

test("public serializer validates the scripting environment", () => {
  assert.throws(
    () => serialize(PUBLIC_SERIALIZER_CASES[0].input(), { scriptingMode: "enabled" }),
    (error) => error instanceof HtmlConfigurationError &&
      error.option === "options.scriptingMode" && error.reason === "INVALID_VALUE"
  );
});

function htmlElement(overrides = {}) {
  return {
    id: 1,
    kind: "element",
    namespaceUri: HTML_NAMESPACE_URI,
    localName: "div",
    attributes: [],
    children: [],
    ...overrides
  };
}

function assertInvalidTree(value, option) {
  assert.throws(
    () => serialize(value),
    (error) => error instanceof HtmlConfigurationError &&
      error.reason === "INVALID_VALUE" && error.option === option
  );
}

test("public serializer rejects unsafe names, namespaces, prefixes, and duplicate attributes", () => {
  assertInvalidTree(htmlElement({ localName: "div><script" }), "tree.localName");
  assertInvalidTree(htmlElement({
    attributes: [{ namespaceUri: null, localName: "bad name", value: "x" }]
  }), "tree.attributes[0].localName");
  assertInvalidTree(htmlElement({ namespaceUri: "" }), "tree.namespaceUri");
  assertInvalidTree(htmlElement({ prefix: "html" }), "tree.prefix");
  assertInvalidTree({
    ...htmlElement({ namespaceUri: SVG_NAMESPACE_URI }),
    attributes: [
      { namespaceUri: null, localName: "CLASS", value: "a" },
      { namespaceUri: null, localName: "class", value: "b" }
    ]
  }, "tree.attributes[1]");
  assertInvalidTree(htmlElement({
    attributes: [
      { namespaceUri: "urn:one", prefix: "xml", localName: "lang", value: "en" }
    ]
  }), "tree.attributes[0].prefix");
});

test("public serializer requires unique acyclic ownership and exact template structure", () => {
  const cyclic = htmlElement({ children: [] });
  cyclic.children.push(cyclic);
  assertInvalidTree(cyclic, "tree.children[0]");

  const shared = { id: 2, kind: "text", value: "x" };
  assertInvalidTree(htmlElement({ children: [shared, shared] }), "tree.children[1]");
  assertInvalidTree(htmlElement({ children: [{ id: 1, kind: "text", value: "x" }] }), "tree.children[0].id");
  assertInvalidTree({ id: 1, kind: "templateContent", children: [] }, "tree");
  assertInvalidTree(htmlElement({ localName: "template" }), "tree.templateContent");
  assertInvalidTree(htmlElement({
    templateContent: { id: 2, kind: "templateContent", children: [] }
  }), "tree.templateContent");
  assertInvalidTree(htmlElement({
    localName: "template",
    children: [{ id: 2, kind: "text", value: "wrong owner" }],
    templateContent: { id: 3, kind: "templateContent", children: [] }
  }), "tree.children");
});
