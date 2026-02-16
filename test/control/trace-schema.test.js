import assert from "node:assert/strict";
import test from "node:test";

import { BudgetExceededError, parse } from "../../dist/mod.js";

test("trace emits structured events across tokenization and tree phases", () => {
  const traced = parse("<!doctype html><table><tr><td>a</td></tr>outside<tr><td>b</td></tr></table>", {
    trace: true,
    budgets: {
      maxTraceEvents: 128,
      maxTraceBytes: 32768
    }
  });

  assert.ok(Array.isArray(traced.trace));
  assert.ok((traced.trace?.length ?? 0) > 0);

  const requiredKinds = new Set(["decode", "token", "insertionModeTransition", "tree-mutation"]);
  const seenKinds = new Set();
  let previousSeq = 0;

  for (const event of traced.trace ?? []) {
    assert.ok(typeof event.seq === "number");
    assert.ok(event.seq > previousSeq);
    previousSeq = event.seq;
    seenKinds.add(event.kind);

    if (event.kind === "decode") {
      assert.ok(typeof event.source === "string");
      assert.ok(typeof event.encoding === "string");
      assert.ok(typeof event.sniffSource === "string");
    } else if (event.kind === "token") {
      assert.ok(typeof event.count === "number");
      assert.ok(event.count >= 0);
    } else if (event.kind === "insertionModeTransition") {
      assert.ok(typeof event.fromMode === "string");
      assert.ok(typeof event.toMode === "string");
      assert.ok(event.tokenContext && typeof event.tokenContext === "object");
      assert.ok(typeof event.tokenContext.type === "string" || event.tokenContext.type === null);
    } else if (event.kind === "tree-mutation") {
      assert.ok(typeof event.nodeCount === "number");
      assert.ok(typeof event.errorCount === "number");
    } else if (event.kind === "budget") {
      assert.ok(typeof event.budget === "string");
      assert.ok(typeof event.actual === "number");
    } else if (event.kind === "parseError") {
      assert.ok(typeof event.parseErrorId === "string");
      assert.ok(typeof event.startOffset === "number" || event.startOffset === null);
    } else if (event.kind === "stream") {
      assert.ok(typeof event.bytesRead === "number");
    } else {
      assert.fail(`unexpected trace event kind: ${String(event.kind)}`);
    }
  }

  for (const kind of requiredKinds) {
    assert.ok(seenKinds.has(kind));
  }
});

test("trace includes parseError events for malformed input", () => {
  const traced = parse("<div><span></div>", {
    trace: true,
    budgets: {
      maxTraceEvents: 128,
      maxTraceBytes: 32768
    }
  });

  const parseErrorEvents = (traced.trace ?? []).filter((entry) => entry.kind === "parseError");
  assert.ok(parseErrorEvents.length >= 1);
  for (const event of parseErrorEvents) {
    assert.ok(typeof event.parseErrorId === "string");
  }
});

test("trace is bounded by maxTraceEvents", () => {
  assert.throws(
    () => parse("<p>a</p>", { trace: true, budgets: { maxTraceEvents: 3, maxTraceBytes: 4096 } }),
    (error) => {
      assert.ok(error instanceof BudgetExceededError);
      assert.equal(error.payload.budget, "maxTraceEvents");
      return true;
    }
  );
});
