import assert from "node:assert/strict";
import test from "node:test";

import {
  extractTextWithIndependentEngine,
  iterateTextWithIndependentEngine,
  parseBytesWithIndependentEngine,
  parseFragmentWithIndependentEngine,
  parseStreamWithIndependentEngine,
  parseWithIndependentEngine,
  tokenizeByteStreamEagerWithIndependentEngine
} from "../../dist/integration/html-product-adapter.js";
import {
  HtmlAbortError,
  HtmlBudgetExceededError,
  computePatch,
  extractText,
  parse,
  serialize,
  walk
} from "../../dist/mod.js";

const TEXT_CONTENT_OPTIONS = Object.freeze({
  policy: "text-content-v1",
  maxOutputBytes: 4_096,
  maxTokens: 4_096
});

const VISIBLE_TEXT_OPTIONS = Object.freeze({
  policy: "visible-text-html-v1",
  maxOutputBytes: 4_096,
  maxTokens: 4_096,
  maxFallbackInputBytes: 4_096,
  maxFallbackNodes: 64
});

function drain(iterator) {
  const tokens = [];
  let next = iterator.next();
  while (!next.done) {
    tokens.push(next.value);
    next = iterator.next();
  }
  return { tokens, result: next.value };
}

function byteStream(chunks) {
  return new globalThis.ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
}

test("staged document conversion is lossless for processing instructions and template content", () => {
  const source = "<?build release?><!doctype html><template><p>inside</p></template><main>outside</main>";
  const parsed = parseWithIndependentEngine(source, {
    captureSpans: true,
    sourceRetention: "text",
    trace: "events"
  });

  const processingInstruction = parsed.tree.children[0];
  assert.equal(processingInstruction?.kind, "processingInstruction");
  assert.equal(processingInstruction.target, "build");
  assert.equal(processingInstruction.data, "release");
  assert.deepEqual(processingInstruction.span, { start: 0, end: 17 });

  const html = parsed.tree.children.find(
    (node) => node.kind === "element" && node.localName === "html"
  );
  assert.ok(html?.kind === "element");
  const head = html.children.find(
    (node) => node.kind === "element" && node.localName === "head"
  );
  assert.ok(head?.kind === "element");
  const template = head.children.find(
    (node) => node.kind === "element" && node.localName === "template"
  );
  assert.ok(template?.kind === "element");
  assert.deepEqual(template.children, []);
  assert.equal(template.templateContent?.kind, "templateContent");
  assert.equal(template.templateContent.children[0]?.kind, "element");
  assert.equal(
    serialize(parsed.tree),
    "<?build release?><!DOCTYPE html><html><head><template><p>inside</p></template></head>" +
      "<body><main>outside</main></body></html>"
  );
  assert.equal(extractText(parsed.tree, TEXT_CONTENT_OPTIONS).text, "outside");

  const walked = [];
  walk(parsed.tree, (node, depth) => walked.push(`${String(depth)}:${node.kind}`));
  assert.ok(walked.includes("3:templateContent"));
  assert.ok(walked.includes("4:element"));
  assert.equal(parsed.metadata.resourceUsage.nodes, 12);
  assert.equal(parsed.metadata.resourceUsage.maxDepth, 7);
  assert.equal(parsed.tree.trace?.summary.nodeCount, 12);
  assert.equal(parsed.tree.trace.summary.maxDepth, 7);
  assert.equal(
    parsed.metadata.resourceUsage.traceUtf8Bytes,
    parsed.tree.trace.summary.eventUtf8Bytes
  );
  assert.ok(parsed.metadata.resourceUsage.traceUtf8Bytes > 0);
  assert.equal(Object.isFrozen(template.templateContent), true);

  const body = html.children.find(
    (node) => node.kind === "element" && node.localName === "body"
  );
  assert.ok(body?.kind === "element");
  const mainElement = body.children.find(
    (node) => node.kind === "element" && node.localName === "main"
  );
  assert.ok(mainElement?.kind === "element");
  const text = mainElement.children[0];
  assert.ok(text?.kind === "text");
  const plan = computePatch(parsed, [{ kind: "replaceText", target: text.id, value: "changed" }]);
  assert.equal(plan.result, source.replace("outside", "changed"));
});

test("staged element spans cover explicit and parser-implied source extents", () => {
  const source = "<!doctype html><html><body><p class=x>A<table><tr><td>B</table><svg><g>C</svg>";
  const parsed = parseWithIndependentEngine(source, {
    captureSpans: true,
    sourceRetention: "text"
  });
  const byName = new Map();
  walk(parsed.tree, (node) => {
    if (node.kind === "element") byName.set(node.localName, node);
  });

  const paragraph = byName.get("p");
  const table = byName.get("table");
  const cell = byName.get("td");
  const svg = byName.get("svg");
  const body = byName.get("body");
  assert.equal(source.slice(paragraph.span.start, paragraph.span.end), "<p class=x>A");
  assert.equal(source.slice(table.span.start, table.span.end), "<table><tr><td>B</table>");
  assert.equal(source.slice(cell.span.start, cell.span.end), "<td>B");
  assert.equal(source.slice(svg.span.start, svg.span.end), "<svg><g>C</svg>");
  assert.equal(source.slice(body.span.start, body.span.end), source.slice(source.indexOf("<body>")));
});

test("staging does not alter the single production route before atomic cutover", () => {
  const source = "<?build release?><template><p>inside</p></template>";
  const production = parse(source);
  const staged = parseWithIndependentEngine(source);
  assert.equal(production.tree.children[0]?.kind, "comment");
  assert.equal(staged.tree.children[0]?.kind, "processingInstruction");
});

test("text, byte, stream, and fragment adapters preserve their input contracts", async () => {
  const source = "<!doctype html><p>€</p>";
  const bytes = new TextEncoder().encode(source);
  const text = parseWithIndependentEngine(source, { sourceRetention: "text" });
  const decodingOptions = { sourceRetention: "text", transportEncodingLabel: "utf-8" };
  const fromBytes = parseBytesWithIndependentEngine(bytes, decodingOptions);
  const fromStream = await parseStreamWithIndependentEngine(
    byteStream([bytes.subarray(0, 5), bytes.subarray(5)]),
    decodingOptions
  );
  assert.deepEqual(fromBytes.tree, text.tree);
  assert.deepEqual(fromStream.tree, text.tree);
  assert.equal(fromBytes.metadata.inputKind, "bytes");
  assert.equal(fromStream.metadata.inputKind, "stream");
  assert.equal(fromStream.metadata.resourceUsage.encodingPrescanBytes, bytes.byteLength);

  const fragment = parseFragmentWithIndependentEngine("<td>x", "table", { captureSpans: true });
  assert.equal(fragment.contextTagName, "table");
  assert.equal(serialize(fragment), "<tbody><tr><td>x</td></tr></tbody>");
  assert.deepEqual(fragment.children[0]?.spanProvenance, "inferred");
});

test("visible-text nested markup remains on the staged parser route", () => {
  const parsed = parseWithIndependentEngine(
    "<body><noscript><p>independent</p></noscript></body>"
  );
  let noscript;
  walk(parsed.tree, (node) => {
    if (node.kind === "element" && node.localName === "noscript") noscript = node;
  });
  assert.ok(noscript?.kind === "element");
  assert.equal(noscript.children.length, 1);
  assert.equal(noscript.children[0]?.kind, "text");

  const extracted = extractTextWithIndependentEngine(parsed.tree, VISIBLE_TEXT_OPTIONS);
  const iterated = drain(iterateTextWithIndependentEngine(parsed.tree, VISIBLE_TEXT_OPTIONS));
  assert.equal(extracted.text, "independent");
  assert.deepEqual(iterated.result, extracted);
  assert.ok(iterated.tokens.flatMap((token) => token.provenance).every((range) =>
    range.sourceNodeId === noscript.id && range.sourceRole === "noscript-fallback"
  ));

  const templateMarkup = parseWithIndependentEngine(
    "<body><noscript><template>x</template><p>y</p></noscript></body>"
  );
  assert.throws(
    () => extractTextWithIndependentEngine(templateMarkup.tree, {
      ...VISIBLE_TEXT_OPTIONS,
      maxFallbackNodes: 6
    }),
    (error) => error instanceof HtmlBudgetExceededError &&
      error.budget === "maxFallbackNodes" && error.actual === 7
  );
});

test("staged tokenization retains the current-standard token vocabulary", async () => {
  const source = "<?build release?><p a=1>a&amp;b</p>";
  const tokens = await tokenizeByteStreamEagerWithIndependentEngine(
    byteStream([new TextEncoder().encode(source)])
  );
  assert.deepEqual(tokens, [
    { kind: "processingInstruction", target: "build", data: "release" },
    { kind: "startTag", name: "p", attributes: [{ name: "a", value: "1" }], selfClosing: false },
    { kind: "chars", value: "a&b" },
    { kind: "endTag", name: "p" },
    { kind: "eof" }
  ]);
  assert.equal(Object.isFrozen(tokens), true);
  assert.ok(tokens.every(Object.isFrozen));
});

test("engine resource and abort failures map once to public error categories", async () => {
  assert.throws(
    () => parseWithIndependentEngine("<template>x</template>", { budgets: { maxNodes: 5 } }),
    (error) => error instanceof HtmlBudgetExceededError &&
      error.budget === "maxNodes" && error.limit === 5 && error.actual === 6
  );
  assert.throws(
    () => parseWithIndependentEngine("<p a=€>", { budgets: { maxAttributeBytes: 3 } }),
    (error) => error instanceof HtmlBudgetExceededError &&
      error.budget === "maxAttributeBytes" && error.actual === 4
  );

  const controller = new AbortController();
  const reason = Object.freeze({ stop: true });
  controller.abort(reason);
  assert.throws(
    () => parseWithIndependentEngine("x", { signal: controller.signal }),
    (error) => error instanceof HtmlAbortError && error.cause === reason
  );
  await assert.rejects(
    parseStreamWithIndependentEngine(byteStream([]), { signal: controller.signal }),
    (error) => error instanceof HtmlAbortError && error.cause === reason
  );
});

test("staged trace observation is immutable, ordered, reentrant, and failure-transparent", () => {
  const observed = [];
  let nested = false;
  const parsed = parseWithIndependentEngine("<p>x</p>", {
    trace: "events",
    onTraceEvent(event) {
      observed.push(event);
      if (!nested) {
        nested = true;
        assert.equal(parseWithIndependentEngine("<i>y</i>").tree.kind, "document");
      }
    }
  });
  assert.deepEqual(observed, parsed.tree.trace?.mode === "events" ? parsed.tree.trace.events : []);
  assert.ok(observed.every((event) => Object.isFrozen(event)));

  const marker = new Error("callback failure");
  assert.throws(
    () => parseWithIndependentEngine("x", { onTraceEvent() { throw marker; } }),
    (error) => error === marker
  );
});
