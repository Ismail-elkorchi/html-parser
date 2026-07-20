import { createHash } from "node:crypto";

import {
  compareEngineTokenizerFixture,
  loadEngineTokenizerFixtures,
  runEngineTokenizerFixture
} from "../../tmp/test-runtime/test/support/engine-tokenizer-fixtures.js";
import { verifyHtml5libCorpora } from "../../test/support/html5lib-corpora.mjs";
import { writeJson } from "../lib/report.mjs";

const EXPECTED_CLASSIFIED_DIFFERENCES = 38;
const EXPECTED_CLASSIFICATION_SHA256 =
  "3b931b821b41febec2667908f130d602699921a0f208c1d39bde0b99aa579a7c";

function comparableTokens(tokens) {
  return tokens.map((token) => JSON.stringify(token));
}

await verifyHtml5libCorpora();
const fixtures = loadEngineTokenizerFixtures();
let passed = 0;
let failed = 0;
const failures = [];
const classified = [];

for (const fixture of fixtures) {
  let outcome;
  try {
    outcome = runEngineTokenizerFixture(fixture, [fixture.input]);
  } catch (error) {
    failed += 1;
    failures.push({
      id: fixture.id,
      unexpectedError: error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "NonError", message: String(error) }
    });
    continue;
  }

  const comparison = compareEngineTokenizerFixture(fixture, outcome);
  if (comparison.matches) {
    passed += 1;
    continue;
  }

  if (comparison.recognizedStandardsDifference && comparison.difference !== null) {
    classified.push(comparison.difference);
    continue;
  }

  failed += 1;
  const expectedTokens = comparableTokens(fixture.expectedTokens);
  const actualTokens = comparableTokens(outcome.fixtureTokens);
  failures.push({
    id: fixture.id,
    expectedPreview: expectedTokens.slice(0, 8),
    actualPreview: actualTokens.slice(0, 8),
    expectedErrors: fixture.expectedErrorCodes,
    actualErrors: outcome.errors.map((error) => error.code)
  });
}

classified.sort((left, right) => left.id.localeCompare(right.id));
const classificationSha256 = createHash("sha256")
  .update(JSON.stringify(classified))
  .digest("hex");
const classificationsMatch = classified.length === EXPECTED_CLASSIFIED_DIFFERENCES &&
  classificationSha256 === EXPECTED_CLASSIFICATION_SHA256;
const report = {
  schemaVersion: 1,
  suite: "html-parser-tokenizer-conformance",
  generatedAt: new Date().toISOString(),
  cases: {
    total: fixtures.length,
    passed: passed + classified.length,
    failed,
    skipped: 0
  },
  exactPasses: passed,
  skips: [],
  classifiedDifferences: classified.length,
  classificationSha256,
  classificationsMatch,
  classified,
  failures
};

await writeJson("reports/tokenizer.json", report);

if (failed > 0 || !classificationsMatch) {
  console.error(`Tokenizer conformance hard failures: ${failed}`);
  process.exit(1);
}

console.log(
  `Tokenizer fixtures passed=${String(passed)}, classified=${String(classified.length)}, ` +
    `failed=${String(failed)}`
);
