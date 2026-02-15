import assert from "node:assert/strict";
import test from "node:test";

import {
  BudgetExceededError,
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

test("basic serialization placeholder", () => {
  const tree = parse("content");
  assert.equal(serialize(tree), "<html>content</html>");
});

test("budget exceed is structured", () => {
  assert.throws(
    () => parse("too-long", { budgets: { maxInputBytes: 2 } }),
    (error) => {
      assert.ok(error instanceof BudgetExceededError);
      assert.equal(error.payload.code, "BUDGET_EXCEEDED");
      return true;
    }
  );
});
