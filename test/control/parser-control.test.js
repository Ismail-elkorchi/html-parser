import assert from "node:assert/strict";
import test from "node:test";

import {
  HtmlBudgetExceededError,
  parse,
  parseBytes,
  parseFragment,
  serialize
} from "../../dist/mod.js";

test("deterministic node ids for identical input", () => {
  const first = parse("<p>alpha</p>");
  const second = parse("<p>alpha</p>");

  assert.deepEqual(first, second);
});

test("parse bytes baseline", () => {
  const bytes = new Uint8Array([0x3c, 0x62, 0x3e, 0x78, 0x3c, 0x2f, 0x62, 0x3e]);
  const tree = parseBytes(bytes);
  assert.equal(tree.kind, "document");
  assert.equal(tree.children[0].kind, "element");
});

test("parseFragment uses explicit context", () => {
  const fragment = parseFragment("hello", "section");
  assert.equal(fragment.kind, "fragment");
  assert.equal(fragment.contextTagName, "section");
});

test("deterministic fragment ids for identical input", () => {
  const first = parseFragment("<em>alpha</em>", "section");
  const second = parseFragment("<em>alpha</em>", "section");
  assert.deepEqual(first, second);
});

test("serialize reflects full document tree", () => {
  const tree = parse("content");
  assert.equal(serialize(tree), "<html><head></head><body>content</body></html>");
});

test("budget exceed is structured", () => {
  assert.throws(
    () => parse("too-long", { budgets: { maxInputBytes: 2 } }),
    (error) => {
      assert.ok(error instanceof HtmlBudgetExceededError);
      assert.equal(error.code, "BUDGET_EXCEEDED");
      return true;
    }
  );
});

test("string and fragment input budgets measure UTF-8 bytes", () => {
  const input = "é".repeat(10);
  for (const parseInput of [
    () => parse(input, { budgets: { maxInputBytes: 10 } }),
    () => parseFragment(input, "div", { budgets: { maxInputBytes: 10 } })
  ]) {
    assert.throws(parseInput, (error) => {
      assert.ok(error instanceof HtmlBudgetExceededError);
      assert.equal(error.budget, "maxInputBytes");
      assert.equal(error.actual, 20);
      return true;
    });
  }
});

test("byte input budget remains based on transport bytes after legacy decoding", () => {
  const tree = parseBytes(new Uint8Array([0xe9]), {
    transportEncodingLabel: "windows-1252",
    budgets: { maxInputBytes: 1 }
  });
  assert.equal(tree.kind, "document");
});
