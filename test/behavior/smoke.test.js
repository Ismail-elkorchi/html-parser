import assert from "node:assert/strict";
import test from "node:test";

test("production behavior smoke", () => {
  assert.equal(1 + 1, 2);
});
