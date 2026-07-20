import assert from "node:assert/strict";
import test from "node:test";

import {
  HTML_NAMESPACE_URI,
  HtmlAbortError,
  HtmlBudgetExceededError,
  HtmlConfigurationError,
  parse,
  parseBytes,
  parseFragment,
  parseStream
} from "../../dist/mod.js";

const htmlContext = (localName) => ({ namespaceUri: HTML_NAMESPACE_URI, localName });

const encoder = new TextEncoder();

function eventTrace(result) {
  const tree = "tree" in result ? result.tree : result;
  assert.equal(tree.trace?.mode, "events");
  return tree.trace.events;
}

function tokenCount(result) {
  const event = eventTrace(result).find((entry) => entry.kind === "token");
  assert.ok(event && event.kind === "token");
  return event.count;
}

test("trace defaults to no returned data and rejects the removed boolean contract", () => {
  assert.equal(Object.hasOwn(parse("<p>x</p>").tree, "trace"), false);
  assert.throws(() => parse("x", { trace: true }), HtmlConfigurationError);
  assert.throws(() => parse("x", { trace: false }), HtmlConfigurationError);
  assert.throws(() => parse("x", { onTraceEvent: true }), HtmlConfigurationError);
});

test("event mode emits immutable structured events and a matching summary", () => {
  const { tree: traced } = parse("<!doctype html><table><tr><td>a</td></tr>outside<tr><td>b</td></tr></table>", {
    trace: "events",
    budgets: {
      maxTraceEvents: 128,
      maxTraceBytes: 32768
    }
  });
  const events = eventTrace(traced);

  assert.ok(events.length > 0);
  assert.equal(Object.isFrozen(traced.trace), true);
  assert.equal(Object.isFrozen(traced.trace.summary), true);
  assert.equal(Object.isFrozen(events), true);
  assert.equal(traced.trace.summary.eventCount, events.length);
  assert.equal(
    traced.trace.summary.eventUtf8Bytes,
    events.reduce((total, event) => total + encoder.encode(JSON.stringify(event)).byteLength, 0)
  );

  const requiredKinds = new Set(["decode", "token", "insertionModeTransition", "tree-mutation"]);
  const seenKinds = new Set();
  let previousSeq = 0;

  for (const event of events) {
    assert.equal(Object.isFrozen(event), true);
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
      assert.equal(Object.isFrozen(event.tokenContext), true);
      assert.ok(typeof event.fromMode === "string");
      assert.ok(typeof event.toMode === "string");
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

  assert.deepEqual(traced.trace.summary.eventKinds, [...seenKinds].sort());
  for (const kind of requiredKinds) {
    assert.ok(seenKinds.has(kind));
  }
});

test("summary mode returns constant-shape counters without retained events", () => {
  const html = "<table><tr><td>x</table>";
  const { tree: summaryResult } = parse(html, { trace: "summary" });
  const { tree: eventsResult } = parse(html, { trace: "events" });

  assert.equal(summaryResult.trace?.mode, "summary");
  assert.equal(Object.hasOwn(summaryResult.trace ?? {}, "events"), false);
  assert.deepEqual(summaryResult.trace?.summary, eventsResult.trace?.summary);
  assert.equal(summaryResult.trace?.summary.encoding.name, "utf-8");
  assert.equal(summaryResult.trace?.summary.encoding.source, "input");
  assert.equal(summaryResult.trace?.summary.bytesRead, null);
  assert.equal(Object.isFrozen(summaryResult.trace?.summary.eventKinds), true);
});

test("trace counts logical parser tokens once, including EOF", () => {
  assert.equal(tokenCount(parse("", { trace: "events" })), 1);
  assert.equal(
    tokenCount(parse("<!doctype html><main><p>alpha &amp; beta</p></main>", { trace: "events" })),
    7
  );
  assert.equal(tokenCount(parseFragment(
    "a<b>&amp;</b>",
    htmlContext("textarea"),
    { trace: "events" }
  )), 2);
});

test("trace includes parseError events for malformed input", () => {
  const { tree: traced } = parse("<div><span></div>", { trace: "events" });
  const parseErrorEvents = eventTrace(traced).filter((entry) => entry.kind === "parseError");
  assert.ok(parseErrorEvents.length >= 1);
  assert.equal(traced.trace.summary.parseErrorCount, traced.errors.length);
});

test("observer receives the same events synchronously without requiring retention", () => {
  const observed = [];
  let returned = false;
  const { tree: result } = parse("<p>x</p>", {
    onTraceEvent(event) {
      assert.equal(returned, false);
      observed.push(event);
    }
  });
  returned = true;

  assert.equal(Object.hasOwn(result, "trace"), false);
  assert.ok(observed.length > 0);
  assert.deepEqual(observed.map((event) => event.seq), observed.map((_, index) => index + 1));
  assert.ok(observed.every((event) => Object.isFrozen(event)));

  const retainedObserved = [];
  const { tree: retained } = parse("<p>x</p>", {
    trace: "events",
    onTraceEvent(event) {
      retainedObserved.push(event);
    }
  });
  assert.deepEqual(retainedObserved, eventTrace(retained));
  assert.ok(retainedObserved.every((event, index) => event === retained.trace.events[index]));
});

test("observer exceptions and callback-triggered aborts escape immediately", () => {
  const marker = new Error("observer stopped");
  assert.throws(
    () => parse("<p>x</p>", { onTraceEvent() { throw marker; } }),
    (error) => error === marker
  );

  const controller = new globalThis.AbortController();
  const reason = { source: "observer" };
  let callbacks = 0;
  assert.throws(
    () => parse("<p>x</p>", {
      signal: controller.signal,
      onTraceEvent() {
        callbacks += 1;
        controller.abort(reason);
      }
    }),
    (error) => {
      assert.ok(error instanceof HtmlAbortError);
      assert.equal(error.cause, reason);
      return true;
    }
  );
  assert.equal(callbacks, 1);
});

test("observer can start an independent nested parse", () => {
  let nested;
  let invoked = false;
  const { tree: outer } = parse("<main>x</main>", {
    trace: "summary",
    onTraceEvent() {
      if (!invoked) {
        invoked = true;
        nested = parse("<aside>y</aside>", { trace: "summary" }).tree;
      }
    }
  });
  assert.equal(outer.trace?.mode, "summary");
  assert.equal(nested?.trace?.mode, "summary");
});

test("trace retention budgets require event mode and fail at the first unavailable unit", () => {
  for (const trace of [undefined, "none", "summary"]) {
    assert.throws(
      () => parse("x", { ...(trace === undefined ? {} : { trace }), budgets: { maxTraceEvents: 1 } }),
      (error) => error instanceof HtmlConfigurationError && error.reason === "CONFLICTING_OPTIONS"
    );
  }
  assert.throws(
    () => parse("<p>a</p>", { trace: "events", budgets: { maxTraceEvents: 3 } }),
    (error) => error instanceof HtmlBudgetExceededError && error.budget === "maxTraceEvents"
  );
  assert.throws(
    () => parse("<p>é</p>", { trace: "events", budgets: { maxTraceBytes: 1 } }),
    (error) => error instanceof HtmlBudgetExceededError && error.budget === "maxTraceBytes"
  );

  const { tree: multibyte } = parse("<html><x-é></x-é></html>", { trace: "events" });
  assert.equal(multibyte.trace?.mode, "events");
  const exactBytes = multibyte.trace.summary.eventUtf8Bytes;
  assert.equal(
    exactBytes,
    multibyte.trace.events.reduce(
      (total, event) => total + encoder.encode(JSON.stringify(event)).byteLength,
      0
    )
  );
  assert.doesNotThrow(() => parse("<html><x-é></x-é></html>", {
    trace: "events",
    budgets: { maxTraceBytes: exactBytes }
  }));
  assert.throws(
    () => parse("<html><x-é></x-é></html>", {
      trace: "events",
      budgets: { maxTraceBytes: exactBytes - 1 }
    }),
    (error) => error instanceof HtmlBudgetExceededError &&
      error.budget === "maxTraceBytes" &&
      error.limit === exactBytes - 1 &&
      error.actual === exactBytes
  );
});

test("parse options and nested budgets are read once before work", () => {
  const reads = new Map();
  const budgets = new Proxy({ maxNodes: 0 }, {
    get(target, key, receiver) {
      reads.set(`budget:${String(key)}`, (reads.get(`budget:${String(key)}`) ?? 0) + 1);
      return Reflect.get(target, key, receiver);
    }
  });
  const options = new Proxy({ trace: "events", budgets }, {
    get(target, key, receiver) {
      reads.set(`option:${String(key)}`, (reads.get(`option:${String(key)}`) ?? 0) + 1);
      return Reflect.get(target, key, receiver);
    }
  });

  assert.throws(
    () => parse("", options),
    (error) => error instanceof HtmlBudgetExceededError && error.budget === "maxNodes"
  );
  for (const count of reads.values()) {
    assert.equal(count, 1);
  }
});

test("every parse input variant uses a single validated option snapshot", async () => {
  function trackedOptions(values) {
    const reads = new Map();
    return {
      options: new Proxy(values, {
        get(target, key, receiver) {
          reads.set(String(key), (reads.get(String(key)) ?? 0) + 1);
          return Reflect.get(target, key, receiver);
        }
      }),
      reads
    };
  }

  const operations = [
    (options) => parse("<p>x</p>", options),
    (options) => parseFragment("<p>x</p>", htmlContext("div"), options)
  ];
  for (const operation of operations) {
    const tracked = trackedOptions({ trace: "summary" });
    operation(tracked.options);
    assert.ok(tracked.reads.size > 0);
    assert.ok([...tracked.reads.values()].every((count) => count === 1));
  }

  const bytesTracked = trackedOptions({ trace: "summary" });
  parseBytes(new TextEncoder().encode("<p>x</p>"), bytesTracked.options);
  assert.ok([...bytesTracked.reads.values()].every((count) => count === 1));

  const streamTracked = trackedOptions({ trace: "summary" });
  const stream = new globalThis.ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<p>x</p>"));
      controller.close();
    }
  });
  await parseStream(stream, streamTracked.options);
  assert.ok([...streamTracked.reads.values()].every((count) => count === 1));
});
