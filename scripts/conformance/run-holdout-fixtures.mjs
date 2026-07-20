import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { sniffHtmlEncoding } from "../../dist/internal/encoding/sniff.js";
import {
  buildTreeFromHtml,
  normalizeTree
} from "../../test/support/engine-tree-fixture-adapter.mjs";
import {
  ALL_HTML5LIB_FIXTURE_FILES,
  ENCODING_FIXTURE_FILES,
  requireFixtureFiles,
  TREE_FIXTURE_FILES
} from "../../test/support/fixture-sources.mjs";
import {
  PUBLIC_SERIALIZER_CASES,
  isPublicSerializerHoldout,
  runPublicSerializerCase
} from "../../test/support/public-serializer-cases.mjs";
import {
  loadEngineTokenizerFixtures,
  runEngineTokenizerFixture
} from "../../tmp/test-runtime/test/support/engine-tokenizer-fixtures.js";
import { expandTreeDatCases, parseTreeDatFixtures } from "../../test/support/tree-dat.mjs";
import {
  isStaleTokenizerProcessingInstructionExpectation,
  isStaleTreeProcessingInstructionExpectation
} from "../../test/support/stale-fixture-classification.mjs";
import { writeJson } from "../eval/eval-primitives.mjs";

const HOLDOUT_MOD = 10;
const HOLDOUT_RULE = `hash(id) % ${HOLDOUT_MOD} === 0`;
const EXPECTED_TOKENIZER_CLASSIFIED_DIFFERENCES = 1;
const EXPECTED_TOKENIZER_CLASSIFICATION_SHA256 =
  "e2def757244c0aa0ab4781f81bb68093368510c0ae165d451e3d9aba56ffd4ef";
const EXPECTED_TREE_CLASSIFIED_DIFFERENCES = 0;
const EXPECTED_TREE_CLASSIFICATION_SHA256 =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

const encoder = new TextEncoder();

function hashWithMultiplier(fixtureId, multiplier) {
  let hash = 0;
  for (let charIndex = 0; charIndex < fixtureId.length; charIndex += 1) {
    hash = (Math.imul(hash, multiplier) + fixtureId.charCodeAt(charIndex)) >>> 0;
  }
  return hash;
}

function isTreeHoldout(fixtureId) {
  return hashWithMultiplier(fixtureId, 31) % HOLDOUT_MOD === 0;
}

function isEncodingHoldout(fixtureId) {
  return hashWithMultiplier(fixtureId, 29) % HOLDOUT_MOD === 0;
}

function fixtureTokenToComparable(token) {
  return JSON.stringify(token);
}

function parseEncodingDatFixtures(text, fixtureFilePath) {
  const lines = text.split(/\r?\n/);
  const parsedEncodingCases = [];

  let section = "";
  let inputDataLines = [];
  let expectedEncodingLabel = "";

  function pushCurrent() {
    if (inputDataLines.length === 0 && expectedEncodingLabel.trim().length === 0) {
      return;
    }

    if (expectedEncodingLabel.trim().length === 0) {
      return;
    }

    parsedEncodingCases.push({
      id: `${fixtureFilePath}#${parsedEncodingCases.length + 1}`,
      data: inputDataLines.join("\n"),
      expectedEncoding: expectedEncodingLabel.trim().toLowerCase()
    });

    inputDataLines = [];
    expectedEncodingLabel = "";
  }

  for (const line of lines) {
    if (line === "#data") {
      pushCurrent();
      section = "data";
      continue;
    }

    if (line === "#encoding") {
      section = "encoding";
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    if (section === "data") {
      inputDataLines.push(line);
      continue;
    }

    if (section === "encoding") {
      if (expectedEncodingLabel.length > 0) {
        expectedEncodingLabel += "\n";
      }
      expectedEncodingLabel += line;
    }
  }

  pushCurrent();
  return parsedEncodingCases;
}

function normalizeFixtureOutput(value) {
  return value.trimEnd();
}

function sumCases(records) {
  const total = records.reduce((sum, record) => sum + record.cases.total, 0);
  const passed = records.reduce((sum, record) => sum + record.cases.passed, 0);
  const failed = records.reduce((sum, record) => sum + record.cases.failed, 0);
  const skipped = records.reduce((sum, record) => sum + record.cases.skipped, 0);
  return { total, passed, failed, skipped };
}

async function runTokenizerHoldout() {
  const fixtures = loadEngineTokenizerFixtures();
  const selectedCases = fixtures.filter((fixture) => fixture.holdout);

  let passed = 0;
  let failed = 0;
  const failures = [];
  const classified = [];

  for (const fixture of selectedCases) {
    const outcome = runEngineTokenizerFixture(fixture, [fixture.input]);
    const expectedTokens = fixture.expectedTokens.map((token) => fixtureTokenToComparable(token));
    const actualTokens = outcome.fixtureTokens.map((token) => fixtureTokenToComparable(token));
    const isTokenSequenceMatch = JSON.stringify(expectedTokens) === JSON.stringify(actualTokens);

    if (isTokenSequenceMatch) {
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
      suite: "tokenizer",
      id: fixture.id,
      expectedPreview: expectedTokens.slice(0, 8),
      actualPreview: actualTokens.slice(0, 8)
    });
  }

  const classificationSha256 = createHash("sha256")
    .update(JSON.stringify(classified))
    .digest("hex");
  return {
    cases: {
      total: passed + failed,
      passed,
      failed,
      skipped: 0
    },
    holdoutRule: HOLDOUT_RULE,
    holdoutMod: HOLDOUT_MOD,
    totalSurface: fixtures.length,
    classifiedDifferences: classified.length,
    classificationSha256,
    classificationsMatch:
      classified.length === EXPECTED_TOKENIZER_CLASSIFIED_DIFFERENCES &&
      classificationSha256 === EXPECTED_TOKENIZER_CLASSIFICATION_SHA256,
    classified,
    failures
  };
}

async function runTreeHoldout() {
  const allTests = [];
  for (const fixturePath of TREE_FIXTURE_FILES) {
    const fixtureData = await readFile(fixturePath, "utf8");
    const baseCases = parseTreeDatFixtures(fixtureData, fixturePath);
    allTests.push(...expandTreeDatCases(baseCases, {
      unspecifiedModes: [true],
      includeModeInId: false
    }));
  }

  const selectedCases = allTests.filter((testCase) => isTreeHoldout(testCase.id));
  let passed = 0;
  let failed = 0;
  const failures = [];
  const classified = [];

  for (const testCase of selectedCases) {
    const treeBuildResult = buildTreeFromHtml(
      testCase.data,
      {
        maxNodes: 4000,
        maxDepth: 256,
        maxAttributesPerElement: 256,
        maxAttributeBytes: 65536
      },
      {
        fragmentContext: testCase.fragmentContext,
        scriptingEnabled: testCase.scriptingEnabled
      }
    );

    const actualTree = normalizeFixtureOutput(normalizeTree(treeBuildResult.document));
    const expectedTree = normalizeFixtureOutput(testCase.expected);

    if (actualTree === expectedTree) {
      passed += 1;
      continue;
    }

    if (isStaleTreeProcessingInstructionExpectation(
      testCase.data,
      expectedTree,
      actualTree,
      treeBuildResult.errors
    )) {
      classified.push({
        id: testCase.id,
        classification: "stale-processing-instruction-expectation",
        expectedTree,
        actualTree,
        errors: treeBuildResult.errors.map((error) => error.code)
      });
      continue;
    }

    failed += 1;
    failures.push({
      suite: "tree",
      id: testCase.id,
      fragmentContextTagName: testCase.fragmentContext?.localName ?? null,
      scriptingEnabled: testCase.scriptingEnabled,
      treeErrors: treeBuildResult.errors.slice(0, 10)
    });
  }

  const classificationSha256 = createHash("sha256")
    .update(JSON.stringify(classified))
    .digest("hex");
  return {
    cases: {
      total: passed + failed,
      passed,
      failed,
      skipped: 0
    },
    holdoutRule: HOLDOUT_RULE,
    holdoutMod: HOLDOUT_MOD,
    totalSurface: allTests.length,
    classifiedDifferences: classified.length,
    classificationSha256,
    classificationsMatch:
      classified.length === EXPECTED_TREE_CLASSIFIED_DIFFERENCES &&
      classificationSha256 === EXPECTED_TREE_CLASSIFICATION_SHA256,
    classified,
    failures
  };
}

async function runEncodingHoldout() {
  const allCases = [];
  for (const fixturePath of ENCODING_FIXTURE_FILES) {
    const content = await readFile(fixturePath, "utf8");
    allCases.push(...parseEncodingDatFixtures(content, fixturePath));
  }

  const selectedCases = allCases.filter((fixture) => isEncodingHoldout(fixture.id));
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const fixtureCase of selectedCases) {
    const encodedBytes = encoder.encode(fixtureCase.data);
    const encodingResult = sniffHtmlEncoding(encodedBytes, { defaultEncoding: "windows-1252" });

    if (fixtureCase.expectedEncoding === encodingResult.encoding) {
      passed += 1;
      continue;
    }

    failed += 1;
    failures.push({
      suite: "encoding",
      id: fixtureCase.id,
      expected: fixtureCase.expectedEncoding,
      actual: encodingResult.encoding,
      source: encodingResult.source
    });
  }

  return {
    cases: {
      total: selectedCases.length,
      passed,
      failed,
      skipped: 0
    },
    holdoutRule: HOLDOUT_RULE,
    holdoutMod: HOLDOUT_MOD,
    totalSurface: allCases.length,
    failures
  };
}

async function runSerializerHoldout() {
  const selectedCases = PUBLIC_SERIALIZER_CASES.filter((testCase) =>
    isPublicSerializerHoldout(testCase.id)
  );
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const testCase of selectedCases) {
    const actualOutput = runPublicSerializerCase(testCase);

    if (actualOutput === testCase.expected) {
      passed += 1;
      continue;
    }

    failed += 1;
    failures.push({
      suite: "serializer",
      id: testCase.id,
      expected: testCase.expected,
      actual: actualOutput
    });
  }

  return {
    cases: {
      total: selectedCases.length,
      passed,
      failed,
      skipped: 0
    },
    holdoutRule: HOLDOUT_RULE,
    holdoutMod: HOLDOUT_MOD,
    totalSurface: PUBLIC_SERIALIZER_CASES.length,
    failures
  };
}

await requireFixtureFiles(ALL_HTML5LIB_FIXTURE_FILES);
const tokenizerHoldout = await runTokenizerHoldout();
const treeHoldout = await runTreeHoldout();
const encodingHoldout = await runEncodingHoldout();
const serializerHoldout = await runSerializerHoldout();

const suites = {
  tokenizer: tokenizerHoldout,
  tree: treeHoldout,
  encoding: encodingHoldout,
  serializer: serializerHoldout
};

const cases = sumCases([tokenizerHoldout, treeHoldout, encodingHoldout, serializerHoldout]);
const failures = [
  ...tokenizerHoldout.failures,
  ...treeHoldout.failures,
  ...encodingHoldout.failures,
  ...serializerHoldout.failures
];

await writeJson("reports/holdout.json", {
  suite: "holdout",
  timestamp: new Date().toISOString(),
  holdoutRule: HOLDOUT_RULE,
  holdoutMod: HOLDOUT_MOD,
  suites,
  cases,
  skips: [],
  failures
});

if (cases.failed > 0 || !tokenizerHoldout.classificationsMatch ||
    !treeHoldout.classificationsMatch) {
  console.error(`Holdout hard failures: ${cases.failed}`);
  process.exit(1);
}

console.log(
  `Holdout fixtures passed=${cases.passed}, failed=${cases.failed}, total=${cases.total} `
    + `(tokenizer=${tokenizerHoldout.cases.total}, tree=${treeHoldout.cases.total}, `
    + `encoding=${encodingHoldout.cases.total}, serializer=${serializerHoldout.cases.total})`
);
