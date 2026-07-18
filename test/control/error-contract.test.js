import assert from "node:assert/strict";
import { ReadableStream } from "node:stream/web";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  HtmlBudgetExceededError,
  HtmlConfigurationError,
  HtmlPatchPlanningError,
  HtmlStreamReadError,
  applyPatchPlan,
  isHtmlBudgetExceededError,
  isHtmlConfigurationError,
  isHtmlOperationalError,
  isHtmlPatchPlanningError,
  isHtmlStreamReadError,
  parse,
  parseFragment,
  parseStream
} from "../../dist/mod.js";

test("operational errors expose direct immutable fields without payload wrappers", () => {
  const budget = new HtmlBudgetExceededError("maxNodes", 4, 5);
  assert.deepEqual(
    { code: budget.code, budget: budget.budget, limit: budget.limit, actual: budget.actual },
    { code: "BUDGET_EXCEEDED", budget: "maxNodes", limit: 4, actual: 5 }
  );
  assert.equal("payload" in budget, false);
  assert.equal(Object.isFrozen(budget), true);
  assert.throws(() => {
    budget.limit = 10;
  }, TypeError);

  const patch = new HtmlPatchPlanningError("NODE_NOT_FOUND", { target: 42, detail: "missing" });
  assert.equal(patch.code, "PATCH_PLANNING_FAILED");
  assert.equal(patch.reason, "NODE_NOT_FOUND");
  assert.equal(patch.target, 42);
  assert.equal(patch.detail, "missing");
  assert.equal(Object.isFrozen(patch), true);
});

test("structural guards classify errors across realms and package copies", async () => {
  const crossRealmBudget = runInNewContext(
    `(() => {
      const error = new Error("cross-realm budget");
      error.name = "HtmlBudgetExceededError";
      error.code = "BUDGET_EXCEEDED";
      error.budget = "maxDepth";
      error.limit = 2;
      error.actual = 3;
      return Object.freeze(error);
    })()`
  );
  assert.equal(crossRealmBudget instanceof HtmlBudgetExceededError, false);
  assert.equal(isHtmlBudgetExceededError(crossRealmBudget), true);
  assert.equal(isHtmlOperationalError(crossRealmBudget), true);

  const duplicate = await import(`../../dist/public/errors.js?copy=${String(Date.now())}`);
  const duplicateBudget = new duplicate.HtmlBudgetExceededError("maxNodes", 1, 2);
  assert.equal(duplicateBudget instanceof HtmlBudgetExceededError, false);
  assert.equal(isHtmlBudgetExceededError(duplicateBudget), true);

  const hostile = {};
  Object.defineProperty(hostile, "code", {
    get() {
      throw new Error("hostile getter");
    }
  });
  assert.equal(isHtmlOperationalError(hostile), false);
  assert.equal(
    isHtmlBudgetExceededError({
      name: "HtmlBudgetExceededError",
      message: "invalid",
      code: "BUDGET_EXCEEDED",
      budget: "unknown",
      limit: 1,
      actual: 2
    }),
    false
  );
  assert.equal(
    isHtmlBudgetExceededError({ code: "BUDGET_EXCEEDED", budget: "maxNodes", limit: 1, actual: 2 }),
    false
  );
});

test("configuration, patch, and stream failures use distinct structural categories", async () => {
  assert.throws(
    () => parseFragment("x", "  "),
    (error) => {
      assert.ok(error instanceof HtmlConfigurationError);
      assert.equal(isHtmlConfigurationError(error), true);
      assert.equal(error.code, "INVALID_CONFIGURATION");
      assert.equal(error.option, "contextTagName");
      assert.equal(error.reason, "INVALID_VALUE");
      return true;
    }
  );

  assert.throws(
    () => applyPatchPlan("abc", { steps: [{ kind: "slice", start: 2, end: 1 }], result: "" }),
    (error) => {
      assert.ok(error instanceof HtmlPatchPlanningError);
      assert.equal(isHtmlPatchPlanningError(error), true);
      assert.equal(error.reason, "INVALID_PLAN_SLICE");
      return true;
    }
  );

  const cause = new Error("upstream read failed");
  const stream = new ReadableStream({
    pull() {
      throw cause;
    }
  });
  await assert.rejects(parseStream(stream), (error) => {
    assert.ok(error instanceof HtmlStreamReadError);
    assert.equal(isHtmlStreamReadError(error), true);
    assert.equal(error.code, "STREAM_READ_FAILED");
    assert.equal(error.cause, cause);
    assert.equal(Object.isFrozen(error), true);
    return true;
  });
  assert.equal(stream.locked, false);

  const lockedStream = new ReadableStream();
  const heldReader = lockedStream.getReader();
  await assert.rejects(parseStream(lockedStream), (error) => {
    assert.ok(error instanceof HtmlStreamReadError);
    assert.equal(isHtmlStreamReadError(error), true);
    assert.ok(error.cause instanceof TypeError);
    return true;
  });
  heldReader.releaseLock();
});

test("returned parser diagnostics are not operational errors", () => {
  const result = parse("<div><span></div>");
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.every((error) => !isHtmlOperationalError(error)));

  const stream = new HtmlStreamReadError("non-error cause");
  assert.equal(isHtmlStreamReadError(stream), true);
});
