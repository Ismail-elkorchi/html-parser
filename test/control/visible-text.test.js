import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  BudgetExceededError,
  parse,
  visibleText,
  visibleTextTokens,
  visibleTextTokensWithProvenance
} from "../../dist/mod.js";

const FIXTURE_ROOT = "test/fixtures/visible-text/v1";
const FALLBACK_FIXTURE_ROOT = "test/fixtures/visible-text-fallback/v1";

async function loadFixtureIds() {
  const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function loadFallbackFixtureIds() {
  const entries = await readdir(FALLBACK_FIXTURE_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

test("visible-text fixture corpus has required minimum size", async () => {
  const fixtureIds = await loadFixtureIds();
  assert.ok(fixtureIds.length >= 30);
});

test("visibleText and visibleTextTokens match fixture snapshots", async () => {
  const fixtureIds = await loadFixtureIds();
  for (const fixtureId of fixtureIds) {
    const fixtureDir = join(FIXTURE_ROOT, fixtureId);
    const [inputHtml, expectedText, expectedTokensText] = await Promise.all([
      readFile(join(fixtureDir, "input.html"), "utf8"),
      readFile(join(fixtureDir, "expected.txt"), "utf8"),
      readFile(join(fixtureDir, "expected.tokens.json"), "utf8")
    ]);

    const parsed = parse(inputHtml, { captureSpans: true });
    const firstText = visibleText(parsed);
    const secondText = visibleText(parsed);
    const expectedVisibleText = expectedText.replace(/\n$/, "");
    assert.equal(firstText, expectedVisibleText, `visibleText mismatch: ${fixtureId}`);
    assert.equal(secondText, expectedVisibleText, `visibleText deterministic mismatch: ${fixtureId}`);

    const firstTokens = visibleTextTokens(parsed);
    const secondTokens = visibleTextTokens(parsed);
    const expectedTokens = JSON.parse(expectedTokensText);
    assert.deepEqual(firstTokens, expectedTokens, `visibleTextTokens mismatch: ${fixtureId}`);
    assert.deepEqual(secondTokens, expectedTokens, `visibleTextTokens deterministic mismatch: ${fixtureId}`);
  }
});

test("visibleText fallback fixture corpus remains deterministic", async () => {
  const fixtureIds = await loadFallbackFixtureIds();
  assert.ok(fixtureIds.length >= 12);
  for (const fixtureId of fixtureIds) {
    const fixtureDir = join(FALLBACK_FIXTURE_ROOT, fixtureId);
    const [inputHtml, expectedDefaultText, expectedFallbackText, expectedFallbackTokensText] = await Promise.all([
      readFile(join(fixtureDir, "input.html"), "utf8"),
      readFile(join(fixtureDir, "expected.default.txt"), "utf8"),
      readFile(join(fixtureDir, "expected.fallback.txt"), "utf8"),
      readFile(join(fixtureDir, "expected.fallback.tokens.json"), "utf8")
    ]);

    const parsed = parse(inputHtml, { captureSpans: true });
    const expectedDefaultVisibleText = expectedDefaultText.replace(/\n$/, "");
    const expectedFallbackVisibleText = expectedFallbackText.replace(/\n$/, "");
    const defaultValue = visibleText(parsed);
    const fallbackValue = visibleText(parsed, {
      includeAccessibleNameFallback: true
    });
    assert.equal(defaultValue, expectedDefaultVisibleText, `fallback default mismatch: ${fixtureId}`);
    assert.equal(fallbackValue, expectedFallbackVisibleText, `fallback variant mismatch: ${fixtureId}`);

    const firstTokens = visibleTextTokens(parsed, {
      includeAccessibleNameFallback: true
    });
    const secondTokens = visibleTextTokens(parsed, {
      includeAccessibleNameFallback: true
    });
    const expectedTokens = JSON.parse(expectedFallbackTokensText);
    assert.deepEqual(firstTokens, expectedTokens, `fallback tokens mismatch: ${fixtureId}`);
    assert.deepEqual(secondTokens, expectedTokens, `fallback deterministic tokens mismatch: ${fixtureId}`);
  }
});

test("budget errors remain structured on pathological depth input", () => {
  const depth = 180;
  const open = "<div>".repeat(depth);
  const close = "</div>".repeat(depth);
  const pathologicalHtml = `${open}x${close}`;

  let observed = null;
  try {
    parse(pathologicalHtml, {
      budgets: {
        maxDepth: 32
      }
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      observed = error.payload;
    } else {
      throw error;
    }
  }

  assert.ok(observed);
  assert.equal(observed.code, "BUDGET_EXCEEDED");
  assert.equal(observed.budget, "maxDepth");
  assert.equal(typeof observed.limit, "number");
  assert.equal(typeof observed.actual, "number");
  assert.ok(observed.actual > observed.limit);
});

test("visibleText optional accessible-name fallback is opt-in", () => {
  const html = [
    "<main>",
    "<a href=\"/docs\" aria-label=\"Docs\"></a> ",
    "<button aria-label=\"Run\"></button> ",
    "<input type=\"button\" aria-label=\"Submit\">",
    "</main>"
  ].join("");

  const parsed = parse(html);
  const baseline = visibleText(parsed);
  const variant = visibleText(parsed, {
    includeAccessibleNameFallback: true
  });

  assert.equal(baseline, "");
  assert.equal(variant, "Submit");
});

test("accessible-name fallback applies to input aria-label only", () => {
  const parsed = parse([
    "<main>",
    "<a href=\"/x\" aria-label=\"Primary\" title=\"Secondary\"></a>",
    "<button aria-label=\"Action\" title=\"Ignored\"></button>",
    "<input type=\"button\" aria-label=\"Input label\" title=\"Input title\">",
    "<input type=\"button\" title=\"Title only\">",
    "</main>"
  ].join(""));
  const value = visibleText(parsed, {
    includeAccessibleNameFallback: true
  });
  assert.equal(value, "Input label");
});

test("visibleTextTokensWithProvenance is deterministic and reconstructs visible text", () => {
  const parsedA = parse("<main><p>A <img alt=\"B\"></p><table><tr><td>x</td><td>y</td></tr></table></main>");
  const parsedB = parse("<main><p>A <img alt=\"B\"></p><table><tr><td>x</td><td>y</td></tr></table></main>");
  const provenanceA = visibleTextTokensWithProvenance(parsedA);
  const provenanceB = visibleTextTokensWithProvenance(parsedB);
  const text = visibleText(parsedA);

  assert.deepEqual(provenanceA, provenanceB);
  assert.equal(provenanceA.map((entry) => entry.value).join(""), text);
  assert.ok(provenanceA.every((entry) => typeof entry.sourceNodeKind === "string"));
  assert.ok(provenanceA.every((entry) => typeof entry.sourceRole === "string"));
  assert.ok(provenanceA.some((entry) => entry.sourceNodeId !== null));
});
