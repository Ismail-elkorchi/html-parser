import assert from "node:assert/strict";
import { ReadableStream } from "node:stream/web";
import { setTimeout as schedule } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  HtmlAbortError,
  HtmlBudgetExceededError,
  HtmlConfigurationError,
  chunk,
  isHtmlAbortError,
  isHtmlBudgetExceededError,
  isHtmlConfigurationError,
  parse,
  parseBytes,
  parseFragment,
  parseStream,
  serialize,
  tokenizeByteStreamEager,
  visibleText,
  walk
} from "../../dist/mod.js";

const PARSE_BUDGETS = [
  "maxInputBytes",
  "maxDecodedUtf8Bytes",
  "maxNodes",
  "maxDepth",
  "maxParseErrors",
  "maxAttributesPerElement",
  "maxAttributeBytes",
  "maxTraceEvents",
  "maxTraceBytes",
  "maxTimeMs"
];

function assertBudget(error, budget, limit, actual) {
  assert.ok(error instanceof HtmlBudgetExceededError);
  assert.equal(isHtmlBudgetExceededError(error), true);
  assert.equal(error.budget, budget);
  assert.equal(error.limit, limit);
  assert.equal(error.actual, actual);
  return true;
}

test("parse option schemas reject unknown and invalid limits before work", async () => {
  for (const budget of PARSE_BUDGETS) {
    for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", null]) {
      assert.throws(
        () => parse("x", { budgets: { [budget]: invalid } }),
        (error) => {
          assert.ok(error instanceof HtmlConfigurationError);
          assert.equal(isHtmlConfigurationError(error), true);
          assert.equal(error.option, `options.budgets.${budget}`);
          return true;
        }
      );
    }
  }

  assert.throws(
    () => parse("x", { budgets: { unknownBudget: 1 } }),
    (error) => {
      assert.ok(error instanceof HtmlConfigurationError);
      assert.equal(error.reason, "UNKNOWN_OPTION");
      assert.equal(error.option, "options.budgets.unknownBudget");
      return true;
    }
  );
  assert.throws(
    () => parse("x", { includeSpans: true }),
    (error) => {
      assert.ok(error instanceof HtmlConfigurationError);
      assert.equal(error.reason, "UNKNOWN_OPTION");
      assert.equal(error.option, "options.includeSpans");
      return true;
    }
  );
  assert.throws(
    () => parse("x", { budgets: { maxEncodingPrescanBytes: 1 } }),
    (error) => {
      assert.ok(error instanceof HtmlConfigurationError);
      assert.equal(error.reason, "UNKNOWN_OPTION");
      assert.equal(error.option, "options.budgets.maxEncodingPrescanBytes");
      return true;
    }
  );
  await assert.rejects(
    tokenizeByteStreamEager(new ReadableStream(), { budgets: { maxNodes: 1 } }),
    (error) => {
      assert.ok(error instanceof HtmlConfigurationError);
      assert.equal(error.reason, "UNKNOWN_OPTION");
      assert.equal(error.option, "options.budgets.maxNodes");
      return true;
    }
  );
  assert.throws(() => serialize(parse("").tree, { unknown: true }), HtmlConfigurationError);
  assert.throws(() => visibleText(parse("").tree, { unknown: true }), HtmlConfigurationError);
  assert.throws(() => walk(parse("").tree, () => {}, { maxTimeMs: -1 }), HtmlConfigurationError);

  const controller = new globalThis.AbortController();
  controller.abort("already cancelled");
  assert.throws(
    () => parse("x", { budgets: { maxDepth: -1 }, signal: controller.signal }),
    HtmlConfigurationError
  );

  let readerAcquisitions = 0;
  const stream = {
    getReader() {
      readerAcquisitions += 1;
      throw new Error("must not acquire reader");
    }
  };
  await assert.rejects(
    parseStream(stream, { budgets: { maxDepth: Number.NaN } }),
    HtmlConfigurationError
  );
  assert.equal(readerAcquisitions, 0);
});

test("zero limits are valid and fail at the first unavailable unit", () => {
  assert.equal(parse("", { budgets: { maxInputBytes: 0, maxDecodedUtf8Bytes: 0 } }).tree.kind, "document");
  assert.throws(() => parse("x", { budgets: { maxInputBytes: 0 } }), (error) =>
    assertBudget(error, "maxInputBytes", 0, 1));
  assert.throws(() => parse("", { budgets: { maxNodes: 0 } }), (error) =>
    assertBudget(error, "maxNodes", 0, 1));
  assert.throws(() => parse("", { budgets: { maxDepth: 0 } }), (error) =>
    assertBudget(error, "maxDepth", 0, 1));
  assert.throws(() => parse("x", { budgets: { maxParseErrors: 0 } }), (error) =>
    assertBudget(error, "maxParseErrors", 0, 1));
  assert.throws(() => parse("<x a>", { budgets: { maxAttributesPerElement: 0 } }), (error) =>
    assertBudget(error, "maxAttributesPerElement", 0, 1));
  assert.throws(() => parse("<x a>", { budgets: { maxAttributeBytes: 0 } }), (error) =>
    assertBudget(error, "maxAttributeBytes", 0, 1));
  assert.throws(() => parse("", { budgets: { maxTimeMs: 0 } }), (error) =>
    assertBudget(error, "maxTimeMs", 0, 1));
  assert.throws(() => parse("", { trace: "events", budgets: { maxTraceEvents: 0 } }), (error) =>
    assertBudget(error, "maxTraceEvents", 0, 1));
  assert.throws(() => parse("", { trace: "events", budgets: { maxTraceBytes: 0 } }), (error) =>
    assertBudget(error, "maxTraceBytes", 0, 1));
});

test("zero stream prescan retention is valid", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<p>x</p>"));
      controller.close();
    }
  });
  assert.equal((await parseStream(stream, { budgets: { maxEncodingPrescanBytes: 0 } })).tree.kind, "document");
});

test("trace retention stops during parser work instead of retaining an error storm", () => {
  const errorStorm = "\0".repeat(10_000);
  assert.throws(
    () => parse(errorStorm, {
      trace: "events",
      budgets: { maxTraceEvents: 10, maxParseErrors: 1_000 }
    }),
    (error) => assertBudget(error, "maxTraceEvents", 10, 11)
  );
  assert.throws(
    () => parse(errorStorm, {
      trace: "events",
      budgets: { maxTraceBytes: 1_024, maxParseErrors: 1_000 }
    }),
    (error) => assertBudget(error, "maxTraceBytes", 1_024, 1_025)
  );
});

test("tree construction enforces node, depth, parse-error, and attribute budgets", () => {
  const html = "<!doctype html><p>x</p>";
  assert.equal(parse(html, { budgets: { maxNodes: 7, maxDepth: 5, maxParseErrors: 0 } }).tree.kind, "document");
  assert.throws(() => parse(html, { budgets: { maxNodes: 6 } }), (error) =>
    assertBudget(error, "maxNodes", 6, 7));
  assert.throws(() => parse(html, { budgets: { maxDepth: 4 } }), (error) =>
    assertBudget(error, "maxDepth", 4, 5));
  assert.throws(() => parse("</x></y>", { budgets: { maxParseErrors: 0 } }), (error) =>
    assertBudget(error, "maxParseErrors", 0, 1));

  assert.equal(
    parse("<!doctype html><x a b>", { budgets: { maxAttributesPerElement: 2 } }).tree.kind,
    "document"
  );
  assert.throws(
    () => parse("<x a b>", { budgets: { maxAttributesPerElement: 1 } }),
    (error) => assertBudget(error, "maxAttributesPerElement", 1, 2)
  );
  assert.equal(parse("<!doctype html><x é=€>", { budgets: { maxAttributeBytes: 5 } }).tree.kind, "document");
  assert.throws(
    () => parse("<x é=€>", { budgets: { maxAttributeBytes: 4 } }),
    (error) => assertBudget(error, "maxAttributeBytes", 4, 5)
  );
  assert.throws(
    () => parse("<html a><html b>", { budgets: { maxAttributesPerElement: 1 } }),
    (error) => assertBudget(error, "maxAttributesPerElement", 1, 2)
  );
  assert.throws(
    () => parse("<x a=1 a=2>", { budgets: { maxAttributesPerElement: 1 } }),
    (error) => assertBudget(error, "maxAttributesPerElement", 1, 2)
  );
  assert.throws(
    () => parse(`<x a=${"v".repeat(100_000)}>`, { budgets: { maxAttributeBytes: 4 } }),
    (error) => assertBudget(error, "maxAttributeBytes", 4, 5)
  );

  const recovered = "<select><b><option>x</select><option>y";
  assert.equal(parse(recovered, { budgets: { maxNodes: 11, maxDepth: 7 } }).tree.kind, "document");
  assert.throws(() => parse(recovered, { budgets: { maxNodes: 10 } }), (error) =>
    assertBudget(error, "maxNodes", 10, 11));
  assert.throws(() => parse(recovered, { budgets: { maxDepth: 6 } }), (error) =>
    assertBudget(error, "maxDepth", 6, 7));
});

test("decoded UTF-8 budgets are exact for text, bytes, streams, and lone surrogates", async () => {
  assert.equal(parse("é", { budgets: { maxDecodedUtf8Bytes: 2 } }).tree.kind, "document");
  assert.throws(() => parse("é", { budgets: { maxDecodedUtf8Bytes: 1 } }), (error) =>
    assertBudget(error, "maxDecodedUtf8Bytes", 1, 2));
  assert.throws(() => parse("\ud800", { budgets: { maxDecodedUtf8Bytes: 2 } }), (error) =>
    assertBudget(error, "maxDecodedUtf8Bytes", 2, 3));

  const windows1252Euro = new Uint8Array([0x80]);
  assert.equal(
    parseBytes(windows1252Euro, {
      transportEncodingLabel: "windows-1252",
      budgets: { maxDecodedUtf8Bytes: 3 }
    }).tree.kind,
    "document"
  );
  assert.throws(
    () => parseBytes(windows1252Euro, {
      transportEncodingLabel: "windows-1252",
      budgets: { maxDecodedUtf8Bytes: 2 }
    }),
    (error) => assertBudget(error, "maxDecodedUtf8Bytes", 2, 3)
  );

  for (const chunks of [
    [windows1252Euro],
    [new Uint8Array(), windows1252Euro]
  ]) {
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      }
    });
    await assert.rejects(
      parseStream(stream, {
        transportEncodingLabel: "windows-1252",
        budgets: { maxDecodedUtf8Bytes: 2 }
      }),
      (error) => assertBudget(error, "maxDecodedUtf8Bytes", 2, 3)
    );
    assert.equal(stream.locked, false);
  }
});

test("stream tokenization stops attempted duplicate and oversized attributes", async () => {
  const duplicate = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<x a=1 a=2>"));
      controller.close();
    }
  });
  await assert.rejects(
    tokenizeByteStreamEager(duplicate, {
      budgets: { maxAttributesPerElement: 1 }
    }),
    (error) => assertBudget(error, "maxAttributesPerElement", 1, 2)
  );
  assert.equal(duplicate.locked, false);

  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`<x a=${"v".repeat(100_000)}>`));
      controller.close();
    }
  });
  await assert.rejects(
    tokenizeByteStreamEager(oversized, {
      budgets: { maxAttributeBytes: 4 }
    }),
    (error) => assertBudget(error, "maxAttributeBytes", 4, 5)
  );
  assert.equal(oversized.locked, false);
});

test("abort signals preserve their exact reason and stream cleanup", async () => {
  const reason = new Error("stop parsing");
  const controller = new globalThis.AbortController();
  controller.abort(reason);

  for (const operation of [
    () => parse("x", { signal: controller.signal }),
    () => parseBytes(new Uint8Array(), { signal: controller.signal }),
    () => parseFragment("", "div", { signal: controller.signal }),
    () => serialize(parse("").tree, { signal: controller.signal }),
    () => visibleText(parse("").tree, { signal: controller.signal })
  ]) {
    assert.throws(operation, (error) => {
      assert.ok(error instanceof HtmlAbortError);
      assert.equal(isHtmlAbortError(error), true);
      assert.equal(error.cause, reason);
      return true;
    });
  }
  await assert.rejects(
    tokenizeByteStreamEager(new ReadableStream(), { signal: controller.signal }),
    (error) => {
      assert.ok(error instanceof HtmlAbortError);
      assert.equal(isHtmlAbortError(error), true);
      assert.equal(error.cause, reason);
      return true;
    }
  );
  await assert.rejects(parseStream(new ReadableStream(), { signal: controller.signal }), (error) => {
    assert.ok(error instanceof HtmlAbortError);
    assert.equal(error.cause, reason);
    return true;
  });

  const midReason = { source: "mid-read" };
  const midController = new globalThis.AbortController();
  let cancellationReason = null;
  let pulls = 0;
  const pendingStream = new ReadableStream({
    start(streamController) {
      streamController.enqueue(new Uint8Array([0x61]));
      schedule(() => midController.abort(midReason), 0);
    },
    pull() {
      pulls += 1;
      return new Promise(() => {});
    },
    cancel(value) {
      cancellationReason = value;
    }
  });
  await assert.rejects(parseStream(pendingStream, { signal: midController.signal }), (error) => {
    assert.ok(error instanceof HtmlAbortError);
    assert.equal(error.cause, midReason);
    return true;
  });
  assert.ok(cancellationReason instanceof HtmlAbortError);
  assert.equal(cancellationReason.cause, midReason);
  assert.ok(pulls <= 1);
  assert.equal(pendingStream.locked, false);
});

test("stream cancellation failures never replace the original budget or deadline", async () => {
  let reads = 0;
  let releases = 0;
  let pullCancellation = null;
  const pullBoundedStream = {
    getReader() {
      return {
        read() {
          reads += 1;
          return Promise.resolve({ done: false, value: new Uint8Array(8) });
        },
        cancel(reason) {
          pullCancellation = reason;
          return Promise.resolve();
        },
        releaseLock() {
          releases += 1;
        }
      };
    }
  };
  await assert.rejects(
    parseStream(pullBoundedStream, { budgets: { maxInputBytes: 1 } }),
    (error) => assertBudget(error, "maxInputBytes", 1, 2)
  );
  assert.equal(reads, 1);
  assert.equal(releases, 1);
  assert.ok(pullCancellation instanceof HtmlBudgetExceededError);

  let neverCancelReleased = 0;
  const neverCancelStream = {
    getReader() {
      return {
        read() {
          return Promise.resolve({ done: false, value: new Uint8Array(8) });
        },
        cancel() {
          return new Promise(() => {});
        },
        releaseLock() {
          neverCancelReleased += 1;
        }
      };
    }
  };
  const neverCancelStartedAt = globalThis.performance.now();
  await assert.rejects(
    parseStream(neverCancelStream, { budgets: { maxInputBytes: 1 } }),
    (error) => assertBudget(error, "maxInputBytes", 1, 2)
  );
  assert.ok(globalThis.performance.now() - neverCancelStartedAt < 500);
  assert.equal(neverCancelReleased, 1);

  const budgetStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
    },
    cancel() {
      throw new Error("cancel failed");
    }
  });
  await assert.rejects(
    parseStream(budgetStream, { budgets: { maxInputBytes: 1 } }),
    (error) => assertBudget(error, "maxInputBytes", 1, 2)
  );
  assert.equal(budgetStream.locked, false);

  const deadlineStream = new ReadableStream({
    async pull(controller) {
      await delay(10);
      controller.enqueue(new Uint8Array([0x61]));
      controller.close();
    }
  });
  await assert.rejects(
    parseStream(deadlineStream, { budgets: { maxTimeMs: 1 } }),
    (error) => assertBudget(error, "maxTimeMs", 1, 2)
  );
  assert.equal(deadlineStream.locked, false);

  let deadlineCancellation = null;
  const neverStream = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel(reason) {
      deadlineCancellation = reason;
    }
  });
  const startedAt = globalThis.performance.now();
  await assert.rejects(
    parseStream(neverStream, { budgets: { maxTimeMs: 10 } }),
    (error) => assertBudget(error, "maxTimeMs", 10, 11)
  );
  assert.ok(globalThis.performance.now() - startedAt < 500);
  assert.ok(deadlineCancellation instanceof HtmlBudgetExceededError);
  assert.equal(neverStream.locked, false);
});

test("traversal observes cancellation triggered by a callback", () => {
  const { tree } = parse("<!doctype html><main><p>a</p><p>b</p></main>");
  const reason = "visitor stop";
  const controller = new globalThis.AbortController();
  let visits = 0;
  assert.throws(
    () => walk(tree, () => {
      visits += 1;
      controller.abort(reason);
    }, { signal: controller.signal }),
    (error) => {
      assert.ok(error instanceof HtmlAbortError);
      assert.equal(error.cause, reason);
      return true;
    }
  );
  assert.equal(visits, 1);
});

test("serialization, traversal, and extraction own independent zero deadlines", () => {
  const { tree } = parse("<!doctype html><main><p>x</p></main>");
  for (const operation of [
    () => serialize(tree, { maxTimeMs: 0 }),
    () => visibleText(tree, { maxTimeMs: 0 }),
    () => walk(tree, () => {}, { maxTimeMs: 0 })
  ]) {
    assert.throws(operation, (error) => assertBudget(error, "maxTimeMs", 0, 1));
  }
});

test("non-parse operations use one immutable option snapshot", () => {
  const { tree } = parse("<main><p>x</p></main>");
  const operations = [
    (options) => serialize(tree, options),
    (options) => visibleText(tree, options),
    (options) => walk(tree, () => {}, options),
    (options) => chunk(tree, options)
  ];

  for (const operation of operations) {
    const reads = new Map();
    const options = new Proxy({ maxTimeMs: 1_000 }, {
      get(target, key, receiver) {
        reads.set(String(key), (reads.get(String(key)) ?? 0) + 1);
        return Reflect.get(target, key, receiver);
      }
    });
    operation(options);
    assert.ok(reads.size > 0);
    assert.ok([...reads.values()].every((count) => count === 1));
  }
});
