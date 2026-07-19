import assert from "node:assert/strict";
import test from "node:test";

import {
  InternalStateError,
  failInternalState,
  requireInternalValue
} from "../../../src/internal/foundation/internal-state-error.js";

void test("internal contradictions have one immutable structured category", () => {
  const error = new InternalStateError("TOKENIZER_CURRENT_TAG_MISSING");

  assert.ok(error instanceof Error);
  assert.equal(error.name, "InternalStateError");
  assert.equal(error.code, "HTML_INTERNAL_STATE_ERROR");
  assert.equal(error.component, "tokenizer");
  assert.equal(error.reason, "TOKENIZER_CURRENT_TAG_MISSING");
  assert.equal(
    error.message,
    "HTML parser internal state failure: TOKENIZER_CURRENT_TAG_MISSING"
  );
  assert.ok(Object.isFrozen(error));
});

void test("internal value narrowing preserves present falsy values and rejects absence", () => {
  assert.equal(requireInternalValue(0, "INPUT_CURSOR_BUFFER_UNDERRUN"), 0);
  assert.equal(requireInternalValue("", "INPUT_CURSOR_BUFFER_UNDERRUN"), "");
  assert.equal(requireInternalValue(false, "INPUT_CURSOR_BUFFER_UNDERRUN"), false);

  assert.throws(
    () => requireInternalValue(null, "INPUT_CURSOR_BUFFER_UNDERRUN"),
    (error: unknown) => error instanceof InternalStateError &&
      error.component === "input-cursor" &&
      error.reason === "INPUT_CURSOR_BUFFER_UNDERRUN"
  );
});

void test("direct internal failures retain their machine-readable reason", () => {
  assert.throws(
    () => failInternalState("TREE_ADAPTER_CHILD_CONVERSION_MISSING"),
    (error: unknown) => error instanceof InternalStateError &&
      error.component === "tree-adapter" &&
      error.reason === "TREE_ADAPTER_CHILD_CONVERSION_MISSING"
  );
});
