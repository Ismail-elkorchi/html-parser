import assert from "node:assert/strict";
import test from "node:test";

import { ActiveFormattingList } from "../../../src/internal/html-engine/active-formatting-list.js";
import { HTML_NAMESPACE } from "../../../src/internal/html-engine/namespaces.js";
import { sourceSpan } from "../../../src/internal/html-engine/positions.js";
import {
  EngineResourceLimitError,
  createEngineResourceGuard
} from "../../../src/internal/html-engine/resource-guard.js";
import {
  HtmlTreeModel,
  type HtmlTreeAttributeInput,
  type HtmlTreeElement
} from "../../../src/internal/html-engine/tree-model.js";

import type { HtmlStartTagToken } from "../../../src/internal/html-engine/tokens.js";

function token(name: string, attributes: HtmlStartTagToken["attributes"] = []): HtmlStartTagToken {
  return Object.freeze({
    kind: "start-tag",
    name,
    attributes: Object.freeze(attributes),
    selfClosing: false,
    span: sourceSpan(0, 0)
  });
}

function element(
  model: HtmlTreeModel,
  name: string,
  attributes: readonly HtmlTreeAttributeInput[] = []
): HtmlTreeElement {
  return model.createElement({
    namespaceUri: HTML_NAMESPACE,
    prefix: null,
    localName: name,
    qualifiedName: name,
    attributes
  });
}

void test("Noah families ignore attribute order and retain only the newest three", () => {
  const resources = createEngineResourceGuard();
  const model = new HtmlTreeModel({ rootKind: "fragment", resources });
  const list = new ActiveFormattingList(resources);
  const first = element(model, "b", [
    { namespaceUri: null, prefix: null, localName: "a", qualifiedName: "a", value: "1" },
    { namespaceUri: null, prefix: null, localName: "z", qualifiedName: "z", value: "2" }
  ]);
  const reordered = [
    { namespaceUri: null, prefix: null, localName: "z", qualifiedName: "z", value: "2" },
    { namespaceUri: null, prefix: null, localName: "a", qualifiedName: "a", value: "1" }
  ] as const;
  list.pushElement(first, token("b"));
  const retained: HtmlTreeElement[] = [];
  for (let count = 0; count < 3; count += 1) {
    const next = element(model, "b", reordered);
    retained.push(next);
    list.pushElement(next, token("b"));
  }

  assert.equal(list.length, 3);
  assert.equal(list.includesElement(first), false);
  assert.deepEqual(retained.map((candidate) => list.includesElement(candidate)), [true, true, true]);
  const distinct = element(model, "b", [
    { namespaceUri: null, prefix: null, localName: "a", qualifiedName: "a", value: "different" },
    { namespaceUri: null, prefix: null, localName: "z", qualifiedName: "z", value: "2" }
  ]);
  list.pushElement(distinct, token("b"));
  assert.equal(list.length, 4);
  assert.equal(list.includesElement(distinct), true);
});

void test("markers isolate families, lookup, clearing, replacement, and bookmark insertion", () => {
  const resources = createEngineResourceGuard();
  const model = new HtmlTreeModel({ rootKind: "fragment", resources });
  const list = new ActiveFormattingList(resources);
  const before = element(model, "a");
  const after = element(model, "a");
  const replacement = element(model, "a");
  list.pushElement(before, token("a"));
  const marker = list.pushMarker();
  const afterEntry = list.pushElement(after, token("a"));

  assert.equal(list.lastElementWithTagName("a")?.element, after);
  assert.equal(list.previous(afterEntry), marker);
  const replacementEntry = list.replace(afterEntry, replacement);
  assert.equal(list.next(marker), replacementEntry);
  list.remove(replacementEntry);
  const inserted = list.insertElementBefore(null, after, afterEntry.token);
  assert.equal(list.last(), inserted);
  list.clearToMarker();
  assert.equal(list.length, 1);
  assert.equal(list.lastElementWithTagName("a")?.element, before);
});

void test("Noah limits and subject lookup do not cross marker generations", () => {
  const resources = createEngineResourceGuard();
  const model = new HtmlTreeModel({ rootKind: "fragment", resources });
  const list = new ActiveFormattingList(resources);
  for (let index = 0; index < 3; index += 1) list.pushElement(element(model, "b"), token("b"));
  list.pushMarker();
  for (let index = 0; index < 4; index += 1) list.pushElement(element(model, "b"), token("b"));
  assert.equal(list.length, 7);
  list.clearToMarker();
  assert.equal(list.length, 3);
  assert.equal(list.lastElementWithTagName("b")?.element.localName, "b");
});

void test("formatting-list work stops at the shared step boundary", () => {
  const model = new HtmlTreeModel({ rootKind: "fragment", resources: createEngineResourceGuard() });
  const list = new ActiveFormattingList(createEngineResourceGuard({ limits: { maxSteps: 0 } }));
  assert.throws(
    () => { list.pushElement(element(model, "b"), token("b")); },
    (error) => error instanceof EngineResourceLimitError && error.resource === "maxSteps"
  );
  assert.equal(list.length, 0);
});
