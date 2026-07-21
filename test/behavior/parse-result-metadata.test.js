import assert from "node:assert/strict";
import test from "node:test";

import {
  HTML_NAMESPACE_URI,
  HtmlConfigurationError,
  HtmlPatchPlanningError,
  TEXT_CONTENT_POLICY,
  applyPatchPlan,
  computePatch,
  extractText,
  parse,
  parseBytes,
  parseFragment,
  parseStream,
  serialize
} from "../../dist/mod.js";

function byteStream(chunks) {
  return new globalThis.ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    }
  });
}

function firstTextId(document) {
  const stack = [...document.tree.children].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node?.kind === "text") {
      return node.id;
    }
    if (node?.kind === "element") {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
  assert.fail("expected a text node");
}

function assertPatchReason(operation, reason) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof HtmlPatchPlanningError);
    assert.equal(error.reason, reason);
    return true;
  });
}

test("full-document parse results have one stable source and metadata shape", () => {
  const input = "<p>é</p>";
  const discarded = parse(input);
  const retained = parse(input, { sourceRetention: "text" });

  assert.deepEqual(Object.keys(discarded), ["tree", "sourceText", "metadata"]);
  assert.equal(discarded.sourceText, null);
  assert.equal(retained.sourceText, input);
  assert.equal(retained.tree.kind, "document");
  assert.deepEqual(retained.metadata, {
    inputKind: "text",
    transportByteLength: null,
    encoding: { name: null, source: "already-decoded" },
    resourceUsage: {
      inputBytes: 9,
      decodedUtf8Bytes: 9,
      decodedCodeUnits: 8,
      steps: null,
      nodes: 6,
      maxDepth: 5,
      parseErrors: 1,
      attributes: 0,
      attributeUtf8Bytes: 0,
      encodingPrescanBytes: 0,
      traceEvents: 0,
      traceUtf8Bytes: 0
    }
  });
  assert.equal(Object.isFrozen(retained), true);
  assert.equal(Object.isFrozen(retained.tree), true);
  assert.equal(Object.isFrozen(retained.tree.children), true);
  assert.equal(Object.isFrozen(retained.tree.errors), true);
  assert.equal(Object.isFrozen(retained.metadata), true);
  assert.equal(Object.isFrozen(retained.metadata.encoding), true);
  assert.equal(Object.isFrozen(retained.metadata.resourceUsage), true);
});

test("already-decoded APIs reject transport and source-retention category errors before work", () => {
  assert.throws(
    () => parse("<p>x</p>", { transportEncodingLabel: "utf-8" }),
    (error) => error instanceof HtmlConfigurationError &&
      error.option === "options.transportEncodingLabel" &&
      error.reason === "UNKNOWN_OPTION"
  );
  assert.throws(
    () => parseFragment(
      "<p>x</p>",
      { namespaceUri: HTML_NAMESPACE_URI, localName: "div" },
      { sourceRetention: "text" }
    ),
    (error) => error instanceof HtmlConfigurationError &&
      error.option === "options.sourceRetention" &&
      error.reason === "UNKNOWN_OPTION"
  );
  assert.throws(
    () => parse("<p>x</p>", { sourceRetention: "bytes" }),
    (error) => error instanceof HtmlConfigurationError &&
      error.option === "options.sourceRetention" &&
      error.reason === "INVALID_VALUE"
  );
});

test("byte and stream results own decoding evidence and exact retained source", async () => {
  const bytes = new Uint8Array([0x3c, 0x70, 0x3e, 0x80, 0x3c, 0x2f, 0x70, 0x3e]);
  const options = {
    captureSpans: true,
    sourceRetention: "text",
    transportEncodingLabel: "windows-1252"
  };
  const fromBytes = parseBytes(bytes, options);
  const fromStream = await parseStream(
    byteStream([bytes.subarray(0, 3), bytes.subarray(3)]),
    options
  );

  for (const document of [fromBytes, fromStream]) {
    assert.equal(document.sourceText, "<p>€</p>");
    assert.equal(extractText(document.tree, {
      policy: TEXT_CONTENT_POLICY,
      maxOutputBytes: 100,
      maxTokens: 100
    }).text, "€");
    assert.equal(serialize(document.tree), "<html><head></head><body><p>€</p></body></html>");
    assert.deepEqual(document.metadata.encoding, {
      name: "windows-1252",
      source: "transport"
    });
    assert.equal(document.metadata.transportByteLength, bytes.byteLength);
    assert.equal(document.metadata.resourceUsage.inputBytes, bytes.byteLength);
    assert.equal(document.metadata.resourceUsage.decodedUtf8Bytes, 10);
    assert.equal(document.metadata.resourceUsage.decodedCodeUnits, 8);
    assert.equal(document.tree.children[0]?.spanProvenance, "inferred");
  }
  assert.equal(fromBytes.metadata.inputKind, "bytes");
  assert.equal(fromBytes.metadata.resourceUsage.encodingPrescanBytes, 0);
  assert.equal(fromStream.metadata.inputKind, "stream");
  assert.equal(fromStream.metadata.resourceUsage.encodingPrescanBytes, bytes.byteLength);
});

test("byte and stream metadata preserve BOM, meta, and default encoding evidence", async () => {
  const encoder = new TextEncoder();
  const fixtures = [
    {
      bytes: new Uint8Array([
        0xef,
        0xbb,
        0xbf,
        ...encoder.encode("<meta charset=windows-1252><p>x</p>")
      ]),
      expected: { name: "utf-8", source: "bom" }
    },
    {
      bytes: new Uint8Array([
        ...encoder.encode("<meta charset=windows-1252><p>"),
        0x80,
        ...encoder.encode("</p>")
      ]),
      expected: { name: "windows-1252", source: "meta" }
    },
    {
      bytes: encoder.encode("<p>ascii</p>"),
      expected: { name: "windows-1252", source: "default" }
    }
  ];

  for (const fixture of fixtures) {
    const fromBytes = parseBytes(fixture.bytes, { sourceRetention: "text" });
    const fromStream = await parseStream(
      byteStream([...fixture.bytes].map((value) => new Uint8Array([value]))),
      { sourceRetention: "text" }
    );
    assert.deepEqual(fromBytes.metadata.encoding, fixture.expected);
    assert.deepEqual(fromStream.metadata.encoding, fixture.expected);
    assert.equal(fromStream.sourceText, fromBytes.sourceText);
    assert.deepEqual(fromStream.tree, fromBytes.tree);
  }
});

test("resource usage reports attempted duplicate attributes and observable trace costs", () => {
  const input = "<p a=1 a=2 é=€>x</p>";
  const observed = [];
  const callbackOnly = parse(input, { onTraceEvent: (event) => observed.push(event) });
  assert.equal(callbackOnly.metadata.resourceUsage.attributes, 3);
  assert.equal(callbackOnly.metadata.resourceUsage.attributeUtf8Bytes, 9);
  assert.equal(callbackOnly.metadata.resourceUsage.nodes, 6);
  assert.equal(callbackOnly.metadata.resourceUsage.maxDepth, 5);
  assert.equal(callbackOnly.metadata.resourceUsage.parseErrors, 2);
  assert.equal(callbackOnly.metadata.resourceUsage.traceEvents, observed.length);
  assert.ok(observed.length > 0);
  assert.equal(callbackOnly.metadata.resourceUsage.traceUtf8Bytes, 0);

  const traced = parse(input, { trace: "events" });
  assert.equal(traced.tree.trace?.mode, "events");
  assert.equal(
    traced.metadata.resourceUsage.traceEvents,
    traced.tree.trace.summary.eventCount
  );
  assert.equal(
    traced.metadata.resourceUsage.traceUtf8Bytes,
    traced.tree.trace.summary.eventUtf8Bytes
  );
  const nodeBudget = traced.tree.trace.events.find(
    (event) => event.kind === "budget" && event.budget === "maxNodes"
  );
  const depthBudget = traced.tree.trace.events.find(
    (event) => event.kind === "budget" && event.budget === "maxDepth"
  );
  assert.equal(nodeBudget?.actual, traced.metadata.resourceUsage.nodes);
  assert.equal(depthBudget?.actual, traced.metadata.resourceUsage.maxDepth);
});

test("step observations are available exactly when deterministic counting is enabled", () => {
  const untracked = parse("<main><p>x</p></main>");
  assert.equal(untracked.metadata.resourceUsage.steps, null);

  const tracked = parse("<main><p>x</p></main>", {
    budgets: { maxSteps: 100_000 },
    trace: "events"
  });
  assert.ok(Number.isSafeInteger(tracked.metadata.resourceUsage.steps));
  assert.ok(tracked.metadata.resourceUsage.steps > 0);
  const stepBudget = tracked.tree.trace.events.find(
    (event) => event.kind === "budget" && event.budget === "maxSteps"
  );
  assert.equal(stepBudget?.actual, tracked.metadata.resourceUsage.steps);
});

test("patch planning and application require exact registered parse identity", () => {
  const source = "<p>alpha</p>";
  const document = parse(source, { captureSpans: true, sourceRetention: "text" });
  const other = parse(source, { captureSpans: true, sourceRetention: "text" });
  const plan = computePatch(document, [
    { kind: "replaceText", target: firstTextId(document), value: "beta" }
  ]);
  assert.equal(plan.result, "<p>beta</p>");
  assert.equal(applyPatchPlan(document, plan), plan.result);
  const textNode = (() => {
    const id = firstTextId(document);
    const stack = [...document.tree.children];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.id === id) return node;
      if (node?.kind === "element") stack.push(...node.children);
    }
    return null;
  })();
  assert.ok(textNode);
  assert.throws(() => {
    textNode.value = "forged";
  }, TypeError);

  assertPatchReason(
    () => computePatch(parse(source, { captureSpans: true }), []),
    "SOURCE_NOT_RETAINED"
  );
  assertPatchReason(
    () => computePatch(parse(source, { sourceRetention: "text" }), []),
    "SPANS_NOT_CAPTURED"
  );
  assertPatchReason(
    () => computePatch({ ...document }, []),
    "UNRECOGNIZED_PARSED_DOCUMENT"
  );
  assertPatchReason(
    () => applyPatchPlan(other, plan),
    "PLAN_SOURCE_MISMATCH"
  );
  assertPatchReason(
    () => applyPatchPlan(document, { ...plan }),
    "PLAN_SOURCE_MISMATCH"
  );
});
