import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPatchPlan,
  computePatch,
  parse,
  HtmlPatchPlanningError,
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
  const { tree: parsed } = parse(html, { captureSpans: true });
  const paragraph = findNode(
    parsed.children,
    (node) => node.kind === "element" && node.localName === "p"
  );

  assert.ok(paragraph);
  assert.ok(paragraph.span);
  assert.equal(paragraph.spanProvenance, "input");
  assert.equal(html.slice(paragraph.span.start, paragraph.span.end), "<p class=\"x\">Hi</p>");

  const classAttribute = paragraph.attributes.find((attribute) => attribute.localName === "class");
  assert.ok(classAttribute);
  assert.ok(classAttribute.span);
  assert.equal(html.slice(classAttribute.span.start, classAttribute.span.end), "class=\"x\"");
});

test("implied wrappers expose inferred span provenance", () => {
  const { tree: parsed } = parse("<p>x</p>", { captureSpans: true });
  const impliedNode = findNode(
    parsed.children,
    (node) =>
      node.kind === "element" &&
      (node.localName === "html" || node.localName === "body") &&
      node.spanProvenance !== "input"
  );

  assert.ok(impliedNode);
  assert.equal(impliedNode.spanProvenance, "inferred");
  assert.equal(impliedNode.span, undefined);
});

test("computePatch supports deterministic structural edit plans", () => {
  const original = "<div><p class=\"x\">one</p><p>two</p></div>";
  const parsed = parse(original, { captureSpans: true, sourceRetention: "text" });
  const firstParagraph = findNode(
    parsed.tree.children,
    (node) => node.kind === "element" && node.localName === "p" && serialize(node) === "<p class=\"x\">one</p>"
  );
  const firstText = findNode(
    parsed.tree.children,
    (node) => node.kind === "text" && node.value === "one"
  );

  assert.ok(firstParagraph);
  assert.ok(firstText);

  const edits = [
    { kind: "replaceText", target: firstText.id, value: "uno" },
    { kind: "setAttr", target: firstParagraph.id, name: "class", value: "y" },
    { kind: "insertHtmlAfter", target: firstParagraph.id, html: "<hr>" }
  ];
  const firstPlan = computePatch(parsed, edits);
  const secondPlan = computePatch(parsed, edits);
  assert.deepEqual(firstPlan, secondPlan);

  const patched = applyPatchPlan(parsed, firstPlan);
  assert.equal(patched, "<div><p class=\"y\">uno</p><hr><p>two</p></div>");

  const patchedTree = parse(patched);
  const expectedTree = parse("<div><p class=\"y\">uno</p><hr><p>two</p></div>");
  assert.equal(serialize(patchedTree.tree), serialize(expectedTree.tree));
});

test("computePatch applies HTML escaping rules to text and attributes", () => {
  const original = "<p data-x=old>old</p>";
  const parsed = parse(original, { captureSpans: true, sourceRetention: "text" });
  const paragraph = findNode(
    parsed.tree.children,
    (node) => node.kind === "element" && node.localName === "p"
  );
  const paragraphText = findNode(
    parsed.tree.children,
    (node) => node.kind === "text" && node.value === "old"
  );
  assert.ok(paragraph);
  assert.ok(paragraphText);

  const plan = computePatch(parsed, [
    { kind: "setAttr", target: paragraph.id, name: "data-x", value: "<>&\u00a0\"" },
    { kind: "replaceText", target: paragraphText.id, value: "<>&\u00a0" }
  ]);
  assert.equal(plan.result, "<p data-x=\"&lt;&gt;&amp;&nbsp;&quot;\">&lt;&gt;&amp;&nbsp;</p>");
});

test("computePatch preserves representable raw text and rejects effective end tags", () => {
  const original = "<script>old</script>";
  const parsed = parse(original, { captureSpans: true, sourceRetention: "text" });
  const scriptText = findNode(
    parsed.tree.children,
    (node) => node.kind === "text" && node.value === "old"
  );
  assert.ok(scriptText);

  assert.equal(
    computePatch(parsed, [{ kind: "replaceText", target: scriptText.id, value: "a < b && c > d" }]).result,
    "<script>a < b && c > d</script>"
  );
  assert.throws(
    () => computePatch(parsed, [{
      kind: "replaceText",
      target: scriptText.id,
      value: "before</ScRiPt >after"
    }]),
    (error) => error instanceof HtmlPatchPlanningError &&
      error.reason === "UNREPRESENTABLE_TEXT_VALUE" && error.target === scriptText.id
  );
});

test("computePatch edits attributes without rewriting full nodes", () => {
  const original = "<div><p class=\"x\" data-k=\"v\">one</p></div>";
  const parsed = parse(original, { captureSpans: true, sourceRetention: "text" });
  const paragraph = findNode(
    parsed.tree.children,
    (node) => node.kind === "element" && node.localName === "p"
  );

  assert.ok(paragraph);

  const plan = computePatch(parsed, [{ kind: "removeAttr", target: paragraph.id, name: "class" }]);
  const patched = applyPatchPlan(parsed, plan);
  assert.equal(patched, "<div><p data-k=\"v\">one</p></div>");
});

test("computePatch normalizes HTML attribute identity and validates edit syntax", () => {
  const original = "<p class=old>one</p>";
  const parsed = parse(original, { captureSpans: true, sourceRetention: "text" });
  const paragraph = findNode(
    parsed.tree.children,
    (node) => node.kind === "element" && node.localName === "p"
  );
  assert.ok(paragraph);

  assert.equal(
    computePatch(parsed, [{ kind: "setAttr", target: paragraph.id, name: "CLASS", value: "new" }]).result,
    "<p class=\"new\">one</p>"
  );
  assert.equal(
    computePatch(parsed, [{ kind: "removeAttr", target: paragraph.id, name: "CLASS" }]).result,
    "<p>one</p>"
  );

  for (const name of ["", "bad name", "bad\tname", "x=y", "x/y", "x>y", "x\"y", "x'y", "x\u0000y", "x\u0080y"]) {
    assert.throws(
      () => computePatch(parsed, [{ kind: "setAttr", target: paragraph.id, name, value: "x" }]),
      (error) => error instanceof HtmlPatchPlanningError &&
        error.reason === "INVALID_EDIT" && error.target === paragraph.id
    );
  }
  assert.throws(
    () => computePatch(parsed, [{ kind: "unknown", target: paragraph.id, html: "x" }]),
    (error) => error instanceof HtmlPatchPlanningError && error.reason === "INVALID_EDIT"
  );
  const inherited = Object.assign(
    Object.create({ kind: "setAttr", target: paragraph.id }),
    { name: "class", value: "x" }
  );
  assert.throws(
    () => computePatch(parsed, [inherited]),
    (error) => error instanceof HtmlPatchPlanningError && error.reason === "INVALID_EDIT"
  );
  assert.throws(
    () => computePatch(parsed, { 0: { kind: "removeNode", target: paragraph.id }, length: 1 }),
    (error) => error instanceof HtmlPatchPlanningError && error.reason === "INVALID_EDIT"
  );
  const sparse = new Array(1);
  assert.throws(
    () => computePatch(parsed, sparse),
    (error) => error instanceof HtmlPatchPlanningError && error.reason === "INVALID_EDIT"
  );
  assert.throws(
    () => computePatch(parsed, [
      { kind: "setAttr", target: paragraph.id, name: "CLASS", value: "a" },
      { kind: "removeAttr", target: paragraph.id, name: "class" }
    ]),
    (error) => error instanceof HtmlPatchPlanningError &&
      error.reason === "CONFLICTING_EDITS" && error.target === paragraph.id
  );
});

test("computePatch keeps unnamespaced foreign attributes distinct from namespace attributes", () => {
  const parsed = parse("<svg viewBox='0 0 1 1' xlink:href='#x'></svg>", {
    captureSpans: true,
    sourceRetention: "text"
  });
  const svg = findNode(
    parsed.tree.children,
    (node) => node.kind === "element" && node.localName === "svg"
  );
  assert.ok(svg);

  assert.equal(
    computePatch(parsed, [{ kind: "setAttr", target: svg.id, name: "VIEWBOX", value: "0 0 2 2" }]).result,
    "<svg viewBox=\"0 0 2 2\" xlink:href='#x'></svg>"
  );

  assert.throws(
    () => computePatch(parsed, [{ kind: "setAttr", target: svg.id, name: "xlink:href", value: "#y" }]),
    (error) => error instanceof HtmlPatchPlanningError &&
      error.reason === "ATTRIBUTE_NAME_COLLISION" && error.target === svg.id
  );
  assert.throws(
    () => computePatch(parsed, [{ kind: "removeAttr", target: svg.id, name: "xlink:href" }]),
    (error) => error instanceof HtmlPatchPlanningError &&
      error.reason === "ATTRIBUTE_NOT_FOUND" && error.target === svg.id
  );
});

test("computePatch supports insertHtmlBefore with removeNode", () => {
  const original = "<ul><li>a</li><li>b</li></ul>";
  const parsed = parse(original, { captureSpans: true, sourceRetention: "text" });
  const secondItem = findNode(
    parsed.tree.children,
    (node) => node.kind === "element" && node.localName === "li" && serialize(node) === "<li>b</li>"
  );

  assert.ok(secondItem);

  const plan = computePatch(parsed, [
    { kind: "insertHtmlBefore", target: secondItem.id, html: "<li>x</li>" },
    { kind: "removeNode", target: secondItem.id }
  ]);
  const patched = applyPatchPlan(parsed, plan);
  assert.equal(patched, "<ul><li>a</li><li>x</li></ul>");
});

test("computePatch rejects targets with non-input span provenance", () => {
  const original = "<p>x</p>";
  const parsed = parse(original, { captureSpans: true, sourceRetention: "text" });
  const impliedNode = findNode(
    parsed.tree.children,
    (node) =>
      node.kind === "element" &&
      (node.localName === "html" || node.localName === "body") &&
      node.spanProvenance !== "input"
  );

  assert.ok(impliedNode);

  assert.throws(
    () => computePatch(parsed, [{ kind: "removeNode", target: impliedNode.id }]),
    (error) => {
      assert.ok(error instanceof HtmlPatchPlanningError);
      assert.equal(error.code, "PATCH_PLANNING_FAILED");
      assert.equal(error.reason, "NON_INPUT_SPAN_PROVENANCE");
      assert.equal(error.detail, impliedNode.spanProvenance);
      return true;
    }
  );
});
