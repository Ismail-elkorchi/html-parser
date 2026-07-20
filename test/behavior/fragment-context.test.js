import assert from "node:assert/strict";
import test from "node:test";

import {
  HTML_NAMESPACE_URI,
  MATHML_NAMESPACE_URI,
  SVG_NAMESPACE_URI,
  XLINK_NAMESPACE_URI,
  HtmlConfigurationError,
  chunk,
  parseFragment,
  serialize
} from "../../dist/mod.js";

const htmlContext = (localName) => ({ namespaceUri: HTML_NAMESPACE_URI, localName });

test("fragment context is normalized, retained, and deeply immutable", () => {
  const input = {
    namespaceUri: HTML_NAMESPACE_URI,
    localName: " TeXtArEa ",
    attributes: [{ namespaceUri: XLINK_NAMESPACE_URI, localName: "href", value: "#x" }]
  };
  const fragment = parseFragment("a<b>&amp;", input);

  assert.deepEqual(fragment.context, {
    namespaceUri: HTML_NAMESPACE_URI,
    localName: "textarea",
    attributes: [{ namespaceUri: XLINK_NAMESPACE_URI, localName: "href", value: "#x" }]
  });
  assert.equal(fragment.children[0]?.kind, "text");
  assert.equal(fragment.children[0]?.value, "a<b>&");
  assert.equal(Object.isFrozen(fragment.context), true);
  assert.equal(Object.isFrozen(fragment.context.attributes), true);
  assert.equal(Object.isFrozen(fragment.context.attributes[0]), true);
  input.localName = "div";
  input.attributes[0].value = "changed";
  assert.equal(fragment.context.localName, "textarea");
  assert.equal(fragment.context.attributes[0]?.value, "#x");
});

test("foreign fragment contexts and semantic attributes drive integration rules", () => {
  const svg = parseFragment("<lineargradient/><foreignObject><p>x</p></foreignObject>", {
    namespaceUri: SVG_NAMESPACE_URI,
    localName: "svg"
  });
  assert.deepEqual(
    svg.children.map((node) => node.kind === "element" ? [node.namespaceUri, node.localName] : [node.kind]),
    [
      [SVG_NAMESPACE_URI, "linearGradient"],
      [SVG_NAMESPACE_URI, "foreignObject"]
    ]
  );
  const foreignObject = svg.children[1];
  assert.equal(foreignObject?.kind, "element");
  assert.equal(foreignObject.children[0]?.kind, "element");
  assert.equal(foreignObject.children[0]?.namespaceUri, HTML_NAMESPACE_URI);

  const annotation = parseFragment("<p>x</p>", {
    namespaceUri: MATHML_NAMESPACE_URI,
    localName: "annotation-xml",
    attributes: [{ namespaceUri: null, localName: "encoding", value: "text/html" }]
  });
  assert.equal(annotation.children[0]?.kind, "element");
  assert.equal(annotation.children[0]?.namespaceUri, HTML_NAMESPACE_URI);
});

test("fragment environment controls tree construction and is retained on the result", () => {
  const context = htmlContext("div");
  const standards = parseFragment("<p>x<table><tr><td>y", context);
  const quirks = parseFragment("<p>x<table><tr><td>y", context, { documentMode: "quirks" });
  assert.notDeepEqual(quirks.children, standards.children);
  assert.equal(standards.documentMode, "no-quirks");
  assert.equal(quirks.documentMode, "quirks");

  const withoutForm = parseFragment("<form><input>", context);
  const withForm = parseFragment("<form><input>", context, { hasFormInContextChain: true });
  assert.equal(withoutForm.children[0]?.kind, "element");
  assert.equal(withoutForm.children[0]?.localName, "form");
  assert.equal(withForm.children[0]?.kind, "element");
  assert.equal(withForm.children[0]?.localName, "input");
  assert.equal(withForm.hasFormInContextChain, true);
});

test("serialization and chunking inherit a fragment's scripting mode", () => {
  const fragment = parseFragment(
    "<noscript>&lt;b&gt;</noscript>",
    htmlContext("div"),
    { scriptingMode: "disabled" }
  );
  assert.equal(fragment.scriptingMode, "disabled");
  assert.equal(serialize(fragment), "<noscript>&lt;b&gt;</noscript>");
  assert.equal(serialize(fragment, { scriptingMode: "inert" }), "<noscript><b></noscript>");
  assert.equal(chunk(fragment)[0]?.content, "<noscript>&lt;b&gt;</noscript>");
});

test("fragment context and environment validation reject ambiguous configuration", () => {
  const parseUnknown = parseFragment;
  assert.throws(
    () => parseUnknown("x", "div"),
    (error) => error instanceof HtmlConfigurationError && error.option === "context"
  );
  assert.throws(
    () => parseFragment("x", { ...htmlContext("div"), prefix: "html" }),
    (error) => error instanceof HtmlConfigurationError && error.reason === "UNKNOWN_OPTION"
  );
  assert.throws(
    () => parseFragment("x", {
      ...htmlContext("div"),
      attributes: [
        { namespaceUri: null, localName: "id", value: "a" },
        { namespaceUri: null, localName: "id", value: "b" }
      ]
    }),
    (error) => error instanceof HtmlConfigurationError &&
      error.option === "context.attributes[1]"
  );
  assert.throws(
    () => parseFragment("x", htmlContext("div"), { scriptingMode: "enabled" }),
    (error) => error instanceof HtmlConfigurationError && error.option === "options.scriptingMode"
  );
  assert.throws(
    () => parseFragment("x", htmlContext("div"), { documentMode: "standards" }),
    (error) => error instanceof HtmlConfigurationError && error.option === "options.documentMode"
  );
});
