import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPatchPlan,
  computePatch,
  parse,
  PatchPlanningError,
  serialize
} from "../../dist/mod.js";

function findNode(nodes, predicate) {
  for (const node of nodes) {
    if (predicate(node)) {
      return node;
    }

    if (node.kind === "element") {
      const found = findNode(node.children, predicate);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

test("captureSpans attaches source offsets for elements and attributes", () => {
  const html = "<!doctype html><html><body><p class=\"x\">Hi</p></body></html>";
  const parsed = parse(html, { captureSpans: true });
  const paragraph = findNode(
    parsed.children,
    (node) => node.kind === "element" && node.tagName === "p"
  );

  assert.ok(paragraph);
  assert.ok(paragraph.span);
  assert.equal(html.slice(paragraph.span.start, paragraph.span.end), "<p class=\"x\">Hi</p>");

  const classAttribute = paragraph.attributes.find((attribute) => attribute.name === "class");
  assert.ok(classAttribute);
  assert.ok(classAttribute.span);
  assert.equal(html.slice(classAttribute.span.start, classAttribute.span.end), "class=\"x\"");
});

test("computePatch supports deterministic structural edit plans", () => {
  const original = "<div><p class=\"x\">one</p><p>two</p></div>";
  const parsed = parse(original, { captureSpans: true });
  const firstParagraph = findNode(
    parsed.children,
    (node) => node.kind === "element" && node.tagName === "p" && serialize(node) === "<p class=\"x\">one</p>"
  );
  const firstText = findNode(
    parsed.children,
    (node) => node.kind === "text" && node.value === "one"
  );

  assert.ok(firstParagraph);
  assert.ok(firstText);

  const edits = [
    { kind: "replaceText", target: firstText.id, value: "uno" },
    { kind: "setAttr", target: firstParagraph.id, name: "class", value: "y" },
    { kind: "insertHtmlAfter", target: firstParagraph.id, html: "<hr>" }
  ];
  const firstPlan = computePatch(original, edits);
  const secondPlan = computePatch(original, edits);
  assert.deepEqual(firstPlan, secondPlan);

  const patched = applyPatchPlan(original, firstPlan);
  assert.equal(patched, "<div><p class=\"y\">uno</p><hr><p>two</p></div>");

  const patchedTree = parse(patched);
  const expectedTree = parse("<div><p class=\"y\">uno</p><hr><p>two</p></div>");
  assert.equal(serialize(patchedTree), serialize(expectedTree));
});

test("computePatch edits attributes without rewriting full nodes", () => {
  const original = "<div><p class=\"x\" data-k=\"v\">one</p></div>";
  const parsed = parse(original, { captureSpans: true });
  const paragraph = findNode(
    parsed.children,
    (node) => node.kind === "element" && node.tagName === "p"
  );

  assert.ok(paragraph);

  const plan = computePatch(original, [{ kind: "removeAttr", target: paragraph.id, name: "class" }]);
  const patched = applyPatchPlan(original, plan);
  assert.equal(patched, "<div><p data-k=\"v\">one</p></div>");
});

test("computePatch supports insertHtmlBefore with removeNode", () => {
  const original = "<ul><li>a</li><li>b</li></ul>";
  const parsed = parse(original, { captureSpans: true });
  const secondItem = findNode(
    parsed.children,
    (node) => node.kind === "element" && node.tagName === "li" && serialize(node) === "<li>b</li>"
  );

  assert.ok(secondItem);

  const plan = computePatch(original, [
    { kind: "insertHtmlBefore", target: secondItem.id, html: "<li>x</li>" },
    { kind: "removeNode", target: secondItem.id }
  ]);
  const patched = applyPatchPlan(original, plan);
  assert.equal(patched, "<ul><li>a</li><li>x</li></ul>");
});

test("computePatch throws structured error when target node span is missing", () => {
  const original = "<p>x</p>";
  const parsed = parse(original, { captureSpans: true });
  const impliedNode = findNode(
    parsed.children,
    (node) =>
      node.kind === "element" &&
      (node.tagName === "html" || node.tagName === "body") &&
      node.span === undefined
  );

  assert.ok(impliedNode);

  assert.throws(
    () => computePatch(original, [{ kind: "removeNode", target: impliedNode.id }]),
    (error) => {
      assert.ok(error instanceof PatchPlanningError);
      assert.equal(error.payload.code, "MISSING_NODE_SPAN");
      return true;
    }
  );
});
