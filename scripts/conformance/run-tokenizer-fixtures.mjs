import { createHash } from "node:crypto";

import {
  loadEngineTokenizerFixtures,
  runEngineTokenizerFixture
} from "../../tmp/test-runtime/test/support/engine-tokenizer-fixtures.js";
import { isStaleTokenizerProcessingInstructionExpectation } from "../../test/support/stale-fixture-classification.mjs";
import { writeJson } from "../eval/eval-primitives.mjs";

const HOLDOUT_MOD = 10;
const HOLDOUT_RULE = `hash(id) % ${HOLDOUT_MOD} === 0`;
const EXPECTED_CLASSIFIED_DIFFERENCES = 10;
const EXPECTED_CLASSIFICATION_SHA256 =
  "889a2c31c2b3fbe94223a50a9601c5f98fe2851628f2dfa0f99985c8c5333632";

function comparableTokens(tokens) {
  return tokens.map((token) => JSON.stringify(token));
}

const fixtures = loadEngineTokenizerFixtures();
let passed = 0;
let failed = 0;
let holdoutExcluded = 0;
const failures = [];
const classified = [];

for (const fixture of fixtures) {
  if (fixture.holdout) {
    holdoutExcluded += 1;
    continue;
  }

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

  const expectedTokens = comparableTokens(fixture.expectedTokens);
  const actualTokens = comparableTokens(outcome.fixtureTokens);
  if (JSON.stringify(expectedTokens) === JSON.stringify(actualTokens)) {
    passed += 1;
    continue;
  }

  if (isStaleTokenizerProcessingInstructionExpectation(
    fixture.input,
    fixture.expectedTokens,
    outcome.fixtureTokens,
    outcome.errors
  )) {
    classified.push({
      id: fixture.id,
      classification: "stale-processing-instruction-expectation",
      expected: fixture.expectedTokens,
      actual: outcome.fixtureTokens,
      errors: outcome.errors.map((error) => error.code)
    });
    continue;
  }

  failed += 1;
  failures.push({
    id: fixture.id,
    expectedPreview: expectedTokens.slice(0, 8),
    actualPreview: actualTokens.slice(0, 8)
  });
}

const classificationSha256 = createHash("sha256")
  .update(JSON.stringify(classified))
  .digest("hex");
const classificationsMatch = classified.length === EXPECTED_CLASSIFIED_DIFFERENCES &&
  classificationSha256 === EXPECTED_CLASSIFICATION_SHA256;
const report = {
  suite: "tokenizer",
  timestamp: new Date().toISOString(),
  cases: {
    total: passed + failed,
    passed,
    failed,
    skipped: 0
  },
  holdout: {
    excluded: holdoutExcluded,
    rule: HOLDOUT_RULE,
    mod: HOLDOUT_MOD
  },
  holdoutExcluded,
  holdoutRule: HOLDOUT_RULE,
  holdoutMod: HOLDOUT_MOD,
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

console.log(`Tokenizer fixtures passed=${passed}, failed=${failed}, holdoutExcluded=${holdoutExcluded}`);
