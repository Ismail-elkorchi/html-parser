import assert from "node:assert/strict";
import test from "node:test";

import { scoreFromThresholdToPerfect } from "../../scripts/eval/eval-primitives.mjs";

test("scoreFromThresholdToPerfect returns 1 at strict threshold", () => {
  assert.equal(scoreFromThresholdToPerfect(1, 1), 1);
});

test("scoreFromThresholdToPerfect returns 0 below strict threshold", () => {
  assert.equal(scoreFromThresholdToPerfect(0.999, 1), 0);
});

test("scoreFromThresholdToPerfect remains 1 when above lower threshold", () => {
  assert.equal(scoreFromThresholdToPerfect(1, 0.99), 1);
});
