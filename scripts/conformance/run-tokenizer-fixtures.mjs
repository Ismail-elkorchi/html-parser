import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import {
  requireFixtureFiles,
  TOKENIZER_FIXTURE_FILES
} from "../../test/support/fixture-sources.mjs";
import { tokenizeFixtureCase } from "../../test/support/tokenizer-fixture-adapter.mjs";
import { isStaleTokenizerProcessingInstructionExpectation } from "../../test/support/stale-fixture-classification.mjs";
import { writeJson } from "../eval/eval-primitives.mjs";

const HOLDOUT_MOD = 10;
const HOLDOUT_RULE = `hash(id) % ${HOLDOUT_MOD} === 0`;
const EXPECTED_CLASSIFIED_DIFFERENCES = 10;
const EXPECTED_CLASSIFICATION_SHA256 =
  "889a2c31c2b3fbe94223a50a9601c5f98fe2851628f2dfa0f99985c8c5333632";

function fixtureTokenToComparable(token) {
  return JSON.stringify(token);
}

function tokenizerTokenToFixture(token) {
  if (token.type === "StartTag") {
    return token.selfClosing
      ? ["StartTag", token.name, token.attributes, true]
      : ["StartTag", token.name, token.attributes];
  }

  if (token.type === "EndTag") {
    return ["EndTag", token.name];
  }

  if (token.type === "Comment") {
    return ["Comment", token.data];
  }

  if (token.type === "Doctype") {
    const name = token.name === "" ? null : token.name;
    return ["DOCTYPE", name, token.publicId, token.systemId, !token.forceQuirks];
  }

  if (token.type === "Character") {
    return ["Character", token.data];
  }

  if (token.type === "ProcessingInstruction") {
    return ["ProcessingInstruction", token.target, token.data];
  }

  return null;
}

function computeHoldout(fixtureId) {
  let hash = 0;
  for (let charIndex = 0; charIndex < fixtureId.length; charIndex += 1) {
    hash = (Math.imul(hash, 33) + fixtureId.charCodeAt(charIndex)) >>> 0;
  }
  return hash % HOLDOUT_MOD === 0;
}

const parsedCases = [];
await requireFixtureFiles(TOKENIZER_FIXTURE_FILES);
for (const fixturePath of TOKENIZER_FIXTURE_FILES) {
  const fixtureFile = JSON.parse(await readFile(fixturePath, "utf8"));
  const tests = fixtureFile.tests ?? fixtureFile.xmlViolationTests ?? [];

  for (let index = 0; index < tests.length; index += 1) {
    const fixture = tests[index];
    const fixtureId = `${fixturePath}#${index + 1}`;
    const initialStates = fixture.initialStates ?? ["Data state"];

    for (const initialState of initialStates) {
      parsedCases.push({
        id: `${fixtureId}@${initialState}`,
        fixtureId,
        file: fixturePath,
        description: fixture.description ?? "",
        input: fixture.input ?? "",
        output: fixture.output ?? [],
        initialState,
        lastStartTag: fixture.lastStartTag,
        doubleEscaped: fixture.doubleEscaped ?? false,
        xmlViolationMode: fixturePath.endsWith("xmlViolation.test")
      });
    }
  }
}

let passed = 0;
let failed = 0;
let holdoutExcluded = 0;
const failures = [];
const classified = [];

for (const fixtureCase of parsedCases) {
  if (computeHoldout(fixtureCase.fixtureId)) {
    holdoutExcluded += 1;
    continue;
  }

  let tokenizeResult;
  try {
    tokenizeResult = tokenizeFixtureCase(fixtureCase.input, {
      initialState: fixtureCase.initialState,
      lastStartTag: fixtureCase.lastStartTag,
      doubleEscaped: fixtureCase.doubleEscaped,
      xmlViolationMode: fixtureCase.xmlViolationMode,
      budgets: {
        maxTextBytes: 200000,
        maxTokenBytes: 16000,
        maxParseErrors: 2000,
        maxTimeMs: 50
      },
      debug: {
        enabled: true,
        windowCodePoints: 24,
        lastTokens: 8
      }
    });
  } catch (error) {
    failed += 1;
    failures.push({
      id: fixtureCase.id,
      description: fixtureCase.description,
      unexpectedError: error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "NonError", message: String(error) }
    });
    continue;
  }

  const expectedTokens = fixtureCase.output.map((token) => fixtureTokenToComparable(token));
  const actualFixtureTokens = tokenizeResult.tokens
    .map((token) => tokenizerTokenToFixture(token))
    .filter((token) => token !== null);
  const actualTokens = actualFixtureTokens.map((token) => fixtureTokenToComparable(token));
  const isTokenSequenceMatch = JSON.stringify(expectedTokens) === JSON.stringify(actualTokens);

  if (isTokenSequenceMatch) {
    passed += 1;
    continue;
  }

  if (isStaleTokenizerProcessingInstructionExpectation(
    fixtureCase.input,
    fixtureCase.output,
    actualFixtureTokens,
    tokenizeResult.errors
  )) {
    classified.push({
      id: fixtureCase.id,
      classification: "stale-processing-instruction-expectation",
      expected: fixtureCase.output,
      actual: actualFixtureTokens,
      errors: tokenizeResult.errors.map((error) => error.code)
    });
    continue;
  }

  failed += 1;
  failures.push({
    id: fixtureCase.id,
    expectedPreview: expectedTokens.slice(0, 8),
    actualPreview: actualTokens.slice(0, 8),
    debug: tokenizeResult.debug
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
