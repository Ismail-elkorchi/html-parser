import assert from "node:assert/strict";
import test from "node:test";

import {
  adjustedForeignAttributes,
  adjustedForeignTagName,
  hasForeignBreakoutFontAttribute,
  isForeignBreakoutStartTag,
  isHtmlIntegrationPoint,
  isMathMLTextIntegrationPoint
} from "../../../src/internal/html-engine/foreign-content.js";
import {
  fragmentContextAttributes,
  fragmentTokenizerMode,
  type HtmlFragmentContext
} from "../../../src/internal/html-engine/fragment-context.js";
import {
  HTML_NAMESPACE,
  MATHML_NAMESPACE,
  SVG_NAMESPACE,
  XLINK_NAMESPACE
} from "../../../src/internal/html-engine/namespaces.js";
import { createEngineResourceGuard } from "../../../src/internal/html-engine/resource-guard.js";
import {
  HtmlTreeModel,
  type HtmlTreeAttributeInput
} from "../../../src/internal/html-engine/tree-model.js";

import type { HtmlStartTagToken } from "../../../src/internal/html-engine/tokens.js";

const SPAN = Object.freeze({ startUtf16Offset: 0, endUtf16Offset: 1 });

function context(
  namespaceUri: HtmlFragmentContext["namespaceUri"],
  localName: string,
  attributes: readonly HtmlFragmentContext["attributes"][number][] = []
): HtmlFragmentContext {
  return Object.freeze({ namespaceUri, localName, attributes: Object.freeze(attributes) });
}

function startTag(name: string, attributeNames: readonly string[] = []): HtmlStartTagToken {
  return Object.freeze({
    kind: "start-tag",
    name,
    selfClosing: false,
    attributes: Object.freeze(attributeNames.map((attributeName) => Object.freeze({
      name: attributeName,
      value: "value",
      span: SPAN,
      nameSpan: SPAN,
      valueSpan: SPAN
    }))),
    span: SPAN
  });
}

function modelElement(
  namespaceUri: HtmlFragmentContext["namespaceUri"],
  localName: string,
  attributes: readonly HtmlTreeAttributeInput[] = []
) {
  const model = new HtmlTreeModel({ rootKind: "fragment", resources: createEngineResourceGuard() });
  return model.createElement({
    namespaceUri,
    prefix: null,
    localName,
    qualifiedName: localName,
    attributes
  });
}

void test("fragment tokenizer entry state is selected by HTML context and scripting mode", () => {
  for (const localName of ["title", "textarea"]) {
    assert.equal(fragmentTokenizerMode(context(HTML_NAMESPACE, localName), "disabled"), "rcdata");
  }
  for (const localName of ["style", "xmp", "iframe", "noembed", "noframes"]) {
    assert.equal(fragmentTokenizerMode(context(HTML_NAMESPACE, localName), "disabled"), "rawtext");
  }
  assert.equal(fragmentTokenizerMode(context(HTML_NAMESPACE, "script"), "disabled"), "script-data");
  assert.equal(fragmentTokenizerMode(context(HTML_NAMESPACE, "noscript"), "disabled"), "data");
  assert.equal(fragmentTokenizerMode(context(HTML_NAMESPACE, "noscript"), "inert"), "rawtext");
  assert.equal(fragmentTokenizerMode(context(HTML_NAMESPACE, "plaintext"), "disabled"), "plaintext");
  assert.equal(fragmentTokenizerMode(context(HTML_NAMESPACE, "div"), "disabled"), "data");
  assert.equal(fragmentTokenizerMode(context(SVG_NAMESPACE, "title"), "disabled"), "data");
});

void test("foreign names and expanded attributes are adjusted without mutating tokens", () => {
  const token = startTag("lineargradient", ["viewbox", "xlink:href"]);
  const adjusted = adjustedForeignAttributes(token.attributes, SVG_NAMESPACE);

  assert.equal(adjustedForeignTagName(token.name, SVG_NAMESPACE), "linearGradient");
  assert.deepEqual(adjusted.map((attribute) => ({
    namespaceUri: attribute.namespaceUri,
    prefix: attribute.prefix,
    localName: attribute.localName,
    qualifiedName: attribute.qualifiedName
  })), [
    { namespaceUri: null, prefix: null, localName: "viewBox", qualifiedName: "viewBox" },
    { namespaceUri: XLINK_NAMESPACE, prefix: "xlink", localName: "href", qualifiedName: "xlink:href" }
  ]);
  assert.equal(token.name, "lineargradient");
  assert.deepEqual(token.attributes.map((attribute) => attribute.name), ["viewbox", "xlink:href"]);
  assert.equal(
    adjustedForeignAttributes(startTag("math", ["definitionurl"]).attributes, MATHML_NAMESPACE)[0]
      ?.localName,
    "definitionURL"
  );
  assert.equal(Object.isFrozen(adjusted), true);
});

void test("integration points and foreign breakouts use namespace-aware predicates", () => {
  assert.equal(isMathMLTextIntegrationPoint(modelElement(MATHML_NAMESPACE, "mi")), true);
  assert.equal(isMathMLTextIntegrationPoint(modelElement(HTML_NAMESPACE, "mi")), false);
  assert.equal(isHtmlIntegrationPoint(modelElement(SVG_NAMESPACE, "foreignObject")), true);
  assert.equal(isHtmlIntegrationPoint(modelElement(SVG_NAMESPACE, "g")), false);
  assert.equal(isHtmlIntegrationPoint(modelElement(MATHML_NAMESPACE, "annotation-xml", [{
    namespaceUri: null,
    prefix: null,
    localName: "encoding",
    qualifiedName: "encoding",
    value: "TEXT/HTML"
  }])), true);
  assert.equal(isForeignBreakoutStartTag("table"), true);
  assert.equal(isForeignBreakoutStartTag("unknown"), false);
  assert.equal(hasForeignBreakoutFontAttribute(startTag("font", ["face"])), true);
  assert.equal(hasForeignBreakoutFontAttribute(startTag("font", ["style"])), false);
});

void test("fragment context attributes are copied into frozen model inputs", () => {
  const source = context(MATHML_NAMESPACE, "annotation-xml", [{
    namespaceUri: null,
    prefix: null,
    localName: "encoding",
    qualifiedName: "encoding",
    value: "text/html"
  }]);
  const attributes = fragmentContextAttributes(source);

  assert.equal(Object.isFrozen(attributes), true);
  assert.equal(Object.isFrozen(attributes[0]), true);
  assert.deepEqual(attributes[0], { ...source.attributes[0], sourceSpan: null });
});
