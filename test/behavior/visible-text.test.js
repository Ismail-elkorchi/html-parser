import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  HtmlAbortError,
  HtmlBudgetExceededError,
  HtmlConfigurationError,
  TEXT_CONTENT_POLICY,
  VISIBLE_TEXT_HTML_POLICY,
  extractText,
  findAllByTagName,
  iterateText,
  parse
} from "../../dist/mod.js";

const FIXTURE_ROOT = "test/fixtures/visible-text/v1";
const FALLBACK_FIXTURE_ROOT = "test/fixtures/visible-text-fallback/v1";
const encoder = new TextEncoder();

function visibleOptions(overrides = {}) {
  return {
    policy: VISIBLE_TEXT_HTML_POLICY,
    maxOutputBytes: 10_000_000,
    maxTokens: 1_000_000,
    maxFallbackInputBytes: 10_000_000,
    maxFallbackNodes: 1_000_000,
    ...overrides
  };
}

function rawOptions(overrides = {}) {
  return {
    policy: TEXT_CONTENT_POLICY,
    maxOutputBytes: 10_000_000,
    maxTokens: 1_000_000,
    ...overrides
  };
}

function drain(iterator) {
  const tokens = [];
  while (true) {
    const next = iterator.next();
    if (next.done) {
      return { tokens, result: next.value };
    }
    tokens.push(next.value);
  }
}

async function loadFixtureIds(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

test("visible-text fixture corpus has required minimum size", async () => {
  const fixtureIds = await loadFixtureIds(FIXTURE_ROOT);
  assert.ok(fixtureIds.length >= 30);
});

test("visible policy results and iterator tokens match every fixture snapshot", async () => {
  const fixtureIds = await loadFixtureIds(FIXTURE_ROOT);
  for (const fixtureId of fixtureIds) {
    const fixtureDir = join(FIXTURE_ROOT, fixtureId);
    const [inputHtml, expectedText, expectedTokensText] = await Promise.all([
      readFile(join(fixtureDir, "input.html"), "utf8"),
      readFile(join(fixtureDir, "expected.txt"), "utf8"),
      readFile(join(fixtureDir, "expected.tokens.json"), "utf8")
    ]);
    const { tree } = parse(inputHtml, { captureSpans: true });
    const expected = expectedText.replace(/\n$/, "");
    const first = extractText(tree, visibleOptions());
    const second = extractText(tree, visibleOptions());
    const iterated = drain(iterateText(tree, visibleOptions()));
    const tokenSnapshot = iterated.tokens.map(({ kind, value }) => ({ kind, value }));

    assert.deepEqual(first, second, `result determinism: ${fixtureId}`);
    assert.equal(first.text, expected, `text mismatch: ${fixtureId}`);
    assert.equal(first.totalBytes, encoder.encode(expected).byteLength, `byte total: ${fixtureId}`);
    assert.equal(first.truncated, false, `unexpected truncation: ${fixtureId}`);
    assert.equal(first.policy, VISIBLE_TEXT_HTML_POLICY, `policy: ${fixtureId}`);
    assert.deepEqual(tokenSnapshot, JSON.parse(expectedTokensText), `tokens: ${fixtureId}`);
    assert.deepEqual(iterated.result, first, `iterator result: ${fixtureId}`);
    assert.equal(iterated.tokens.map((entry) => entry.value).join(""), first.text);
  }
});

test("visible fallback variants preserve their versioned snapshots", async () => {
  const fixtureIds = await loadFixtureIds(FALLBACK_FIXTURE_ROOT);
  assert.ok(fixtureIds.length >= 12);
  for (const fixtureId of fixtureIds) {
    const fixtureDir = join(FALLBACK_FIXTURE_ROOT, fixtureId);
    const [inputHtml, expectedDefaultText, expectedFallbackText, expectedTokensText] = await Promise.all([
      readFile(join(fixtureDir, "input.html"), "utf8"),
      readFile(join(fixtureDir, "expected.default.txt"), "utf8"),
      readFile(join(fixtureDir, "expected.fallback.txt"), "utf8"),
      readFile(join(fixtureDir, "expected.fallback.tokens.json"), "utf8")
    ]);
    const { tree } = parse(inputHtml, { captureSpans: true });
    const expectedDefault = expectedDefaultText.replace(/\n$/, "");
    const expectedFallback = expectedFallbackText.replace(/\n$/, "");
    const baseline = extractText(tree, visibleOptions());
    const options = visibleOptions({ includeAccessibleNameFallback: true });
    const fallback = extractText(tree, options);
    const iterated = drain(iterateText(tree, options));

    assert.equal(baseline.text, expectedDefault, `fallback default: ${fixtureId}`);
    assert.equal(fallback.text, expectedFallback, `fallback variant: ${fixtureId}`);
    assert.deepEqual(
      iterated.tokens.map(({ kind, value }) => ({ kind, value })),
      JSON.parse(expectedTokensText),
      `fallback tokens: ${fixtureId}`
    );
    assert.deepEqual(iterated.result, fallback, `fallback iterator result: ${fixtureId}`);
  }
});

test("UTF-8 and token caps retain only scalar-safe policy prefixes", () => {
  const { tree } = parse("<main><p>A😀B</p><p>C</p></main>");
  assert.deepEqual(extractText(tree, visibleOptions({ maxOutputBytes: 5 })), {
    text: "A😀",
    totalBytes: 9,
    truncated: true,
    policy: VISIBLE_TEXT_HTML_POLICY
  });
  assert.deepEqual(extractText(tree, rawOptions({ maxOutputBytes: 5 })), {
    text: "A😀",
    totalBytes: 7,
    truncated: true,
    policy: TEXT_CONTENT_POLICY
  });
  assert.equal(extractText(tree, rawOptions({ maxOutputBytes: 2 })).text, "A");
  assert.deepEqual(extractText(tree, visibleOptions({ maxTokens: 1 })), {
    text: "A😀B",
    totalBytes: 9,
    truncated: true,
    policy: VISIBLE_TEXT_HTML_POLICY
  });
  assert.deepEqual(extractText(tree, rawOptions({ maxOutputBytes: 0, maxTokens: 0 })), {
    text: "",
    totalBytes: 7,
    truncated: true,
    policy: TEXT_CONTENT_POLICY
  });
  assert.equal(extractText(parse("<p>one token</p>").tree, rawOptions({ maxTokens: 1 })).truncated, false);
  assert.equal(/^[\uD800-\uDBFF]$/u.test(extractText(tree, rawOptions({ maxOutputBytes: 2 })).text.at(-1) ?? ""), false);
});

test("deferred whitespace stays output-bounded without changing trim or byte totals", () => {
  const alternating = " \t".repeat(25_000);
  const middle = parse(`<pre>A${alternating}X</pre>`).tree;
  const middleResult = extractText(middle, visibleOptions({ maxOutputBytes: 8 }));
  assert.equal(middleResult.text, `A${alternating}X`.slice(0, 8));
  assert.equal(middleResult.totalBytes, alternating.length + 2);
  assert.equal(middleResult.truncated, true);

  const leading = parse(`<pre>${alternating}X</pre>`).tree;
  assert.deepEqual(extractText(leading, visibleOptions({ maxOutputBytes: 8 })), {
    text: "X",
    totalBytes: 1,
    truncated: false,
    policy: VISIBLE_TEXT_HTML_POLICY
  });

  const trailing = parse(`<pre>A${alternating}</pre>`).tree;
  assert.deepEqual(extractText(trailing, visibleOptions({ maxOutputBytes: 8 })), {
    text: "A",
    totalBytes: 1,
    truncated: false,
    policy: VISIBLE_TEXT_HTML_POLICY
  });

  const untrimmed = extractText(leading, visibleOptions({ maxOutputBytes: 8, trim: false }));
  assert.equal(untrimmed.text, alternating.slice(0, 8));
  assert.equal(untrimmed.totalBytes, alternating.length + 1);
  assert.equal(untrimmed.truncated, true);
});

test("iterator provenance is frozen, coalesced, and expressed in output UTF-8 ranges", () => {
  const { tree } = parse("<main><p>A <img alt=\"B\"></p><table><tr><td>x</td><td>y</td></tr></table></main>");
  const { tokens, result } = drain(iterateText(tree, visibleOptions()));
  assert.equal(tokens.map((entry) => entry.value).join(""), result.text);
  assert.equal(Object.isFrozen(result), true);
  assert.ok(tokens.length > 0);
  assert.ok(tokens.every((token) => Object.isFrozen(token) && Object.isFrozen(token.provenance)));

  let cursor = 0;
  for (const token of tokens) {
    assert.equal(token.policy, VISIBLE_TEXT_HTML_POLICY);
    assert.equal(token.outputByteStart, cursor);
    assert.equal(token.outputByteEnd - token.outputByteStart, encoder.encode(token.value).byteLength);
    let rangeCursor = token.outputByteStart;
    for (const range of token.provenance) {
      assert.equal(Object.isFrozen(range), true);
      assert.equal(range.outputByteStart, rangeCursor);
      assert.ok(range.outputByteEnd > range.outputByteStart);
      assert.equal(typeof range.sourceNodeKind, "string");
      assert.equal(typeof range.sourceRole, "string");
      rangeCursor = range.outputByteEnd;
    }
    assert.equal(rangeCursor, token.outputByteEnd);
    cursor = token.outputByteEnd;
  }
  assert.equal(cursor, encoder.encode(result.text).byteLength);
});

test("noscript provenance targets the owning source node instead of temporary fallback ids", () => {
  const { tree } = parse("<body><noscript><p>fallback</p></noscript></body>");
  const noscript = [...findAllByTagName(tree, "noscript")][0];
  assert.ok(noscript);
  const { tokens } = drain(iterateText(tree, visibleOptions()));
  const ranges = tokens.flatMap((token) => token.provenance);
  assert.ok(ranges.length > 0);
  assert.ok(ranges.every((range) => range.sourceNodeId === noscript.id));
  assert.ok(ranges.every((range) => range.sourceRole === "noscript-fallback"));
});

test("fallback input, node, deadline, and abort controls apply before unbounded nested work", () => {
  const small = parse("<body><noscript><b>x</b></noscript></body>").tree;
  assert.throws(
    () => extractText(small, visibleOptions({ maxFallbackInputBytes: 1 })),
    (error) => error instanceof HtmlBudgetExceededError &&
      error.budget === "maxFallbackInputBytes" && error.actual === 2
  );
  assert.throws(
    () => extractText(small, visibleOptions({ maxFallbackNodes: 0 })),
    (error) => error instanceof HtmlBudgetExceededError &&
      error.budget === "maxFallbackNodes" && error.actual === 1
  );

  const large = parse(`<body><noscript>${"<b>x</b>".repeat(20_000)}</noscript></body>`).tree;
  const started = globalThis.performance.now();
  assert.throws(
    () => extractText(large, visibleOptions({ maxTimeMs: 1 })),
    (error) => error instanceof HtmlBudgetExceededError && error.budget === "maxTimeMs"
  );
  assert.ok(globalThis.performance.now() - started < 250);

  const controller = new globalThis.AbortController();
  const reason = new Error("stop extraction");
  controller.abort(reason);
  assert.throws(
    () => iterateText(small, visibleOptions({ signal: controller.signal })),
    (error) => error instanceof HtmlAbortError && error.cause === reason
  );
});

test("policy-discriminated option schemas reject missing, invalid, and cross-policy fields", () => {
  const { tree } = parse("<p>x</p>");
  assert.throws(
    () => extractText(tree, { policy: VISIBLE_TEXT_HTML_POLICY }),
    (error) => error instanceof HtmlConfigurationError && error.option === "options.maxOutputBytes"
  );
  assert.throws(
    () => extractText(tree, rawOptions({ trim: true })),
    (error) => error instanceof HtmlConfigurationError &&
      error.option === "options.trim" && error.reason === "UNKNOWN_OPTION"
  );
  assert.throws(
    () => extractText(tree, rawOptions({ maxTokens: -1 })),
    (error) => error instanceof HtmlConfigurationError && error.option === "options.maxTokens"
  );
  assert.throws(
    () => extractText(tree, { ...rawOptions(), policy: "visible-v2" }),
    (error) => error instanceof HtmlConfigurationError && error.option === "options.policy"
  );
});

test("accessible-name fallback remains an explicit visible-policy variant", () => {
  const { tree } = parse([
    "<main>",
    "<a href=\"/x\" aria-label=\"Primary\"></a>",
    "<button aria-label=\"Action\"></button>",
    "<input type=\"button\" aria-label=\"Input label\">",
    "<input type=\"button\" title=\"Title only\">",
    "</main>"
  ].join(""));
  assert.equal(extractText(tree, visibleOptions()).text, "");
  assert.equal(
    extractText(tree, visibleOptions({ includeAccessibleNameFallback: true })).text,
    "Input label"
  );
});
