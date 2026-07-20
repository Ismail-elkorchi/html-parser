import assert from "node:assert/strict";
import test from "node:test";

import {
  HTML_NAMESPACE_URI,
  HtmlBudgetExceededError,
  parse,
  parseBytes,
  parseFragment,
  serialize
} from "../../dist/mod.js";

const htmlContext = (localName) => ({ namespaceUri: HTML_NAMESPACE_URI, localName });

test("deterministic node ids for identical input", () => {
  const first = parse("<p>alpha</p>");
  const second = parse("<p>alpha</p>");

  assert.deepEqual(first, second);
});

test("parse bytes baseline", () => {
  const bytes = new Uint8Array([0x3c, 0x62, 0x3e, 0x78, 0x3c, 0x2f, 0x62, 0x3e]);
  const { tree } = parseBytes(bytes);
  assert.equal(tree.kind, "document");
  assert.equal(tree.children[0].kind, "element");
});

test("parseFragment uses explicit context", () => {
  const fragment = parseFragment("hello", htmlContext("section"));
  assert.equal(fragment.kind, "fragment");
  assert.deepEqual(fragment.context, {
    namespaceUri: HTML_NAMESPACE_URI,
    localName: "section",
    attributes: []
  });
});

test("deterministic fragment ids for identical input", () => {
  const first = parseFragment("<em>alpha</em>", htmlContext("section"));
  const second = parseFragment("<em>alpha</em>", htmlContext("section"));
  assert.deepEqual(first, second);
});

test("serialize reflects full document tree", () => {
  const { tree } = parse("content");
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
    () => parseFragment(input, htmlContext("div"), { budgets: { maxInputBytes: 10 } })
  ]) {
    assert.throws(parseInput, (error) => {
      assert.ok(error instanceof HtmlBudgetExceededError);
      assert.equal(error.budget, "maxInputBytes");
      assert.equal(error.actual, 11);
      return true;
    });
  }
});

test("byte input budget remains based on transport bytes after single-byte decoding", () => {
  const { tree } = parseBytes(new Uint8Array([0xe9]), {
    transportEncodingLabel: "windows-1252",
    budgets: { maxInputBytes: 1 }
  });
  assert.equal(tree.kind, "document");
});
