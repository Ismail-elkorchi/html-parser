import assert from "node:assert/strict";
import test from "node:test";

import {
  BudgetExceededError,
  deterministicHash,
  parseBytes,
  parseString,
  serialize
} from "../../dist/mod.js";

test("parse string", () => {
  const result = parseString("<p>ok</p>");
  assert.equal(result.serialization, "<p>ok</p>");
  assert.equal(result.tree.type, "document");
});

test("parse bytes with utf-8 baseline", () => {
  const bytes = new Uint8Array([0x3c, 0x62, 0x3e, 0x78, 0x3c, 0x2f, 0x62, 0x3e]);
  const result = parseBytes(bytes);
  assert.equal(result.serialization, "<b>x</b>");
});

test("serialize round-trip", () => {
  const result = parseString("plain");
  assert.equal(serialize(result), "plain");
});

test("determinism hash stable", () => {
  const first = parseString("abc", { seed: 11 });
  const second = parseString("abc", { seed: 11 });
  assert.equal(deterministicHash(first), deterministicHash(second));
});

test("budget exceed returns structured error", () => {
  assert.throws(
    () => parseString("too-long", { budgets: { maxInputBytes: 3 } }),
    (error) => {
      assert.ok(error instanceof BudgetExceededError);
      assert.equal(error.payload.code, "BUDGET_EXCEEDED");
      assert.equal(error.payload.budget, "maxInputBytes");
      return true;
    }
  );
});
