import assert from "node:assert/strict";
import test from "node:test";

import { applyPatchPlan, computePatch, parse, serialize } from "../../dist/mod.js";

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

test("computePatch creates deterministic plans and preserves parse structure", () => {
  const original = "<div><p>one</p><p>two</p></div>";
  const parsed = parse(original, { captureSpans: true });
  const secondParagraph = findNode(
    parsed.children,
    (node) => node.kind === "element" && node.tagName === "p" && serialize(node) === "<p>two</p>"
  );

  assert.ok(secondParagraph);

  const edits = [{ nodeId: secondParagraph.id, replacementHtml: "<p>dos</p>" }];
  const firstPlan = computePatch(original, edits);
  const secondPlan = computePatch(original, edits);
  assert.deepEqual(firstPlan, secondPlan);

  const patched = applyPatchPlan(original, firstPlan);
  assert.equal(patched, "<div><p>one</p><p>dos</p></div>");

  const patchedTree = parse(patched);
  const expectedTree = parse("<div><p>one</p><p>dos</p></div>");
  assert.equal(serialize(patchedTree), serialize(expectedTree));
});
