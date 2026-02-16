import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { BudgetExceededError, parse, visibleText, visibleTextTokens } from "../../dist/mod.js";

const FIXTURE_ROOT = "test/fixtures/visible-text/v1";

async function loadFixtureIds() {
  const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true });
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
