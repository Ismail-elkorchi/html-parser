import { readFile } from "node:fs/promises";

import { sniffHtmlEncoding } from "../../dist/internal/encoding/sniff.js";
import { buildTreeFromHtml, normalizeTree } from "../../dist/internal/tree/mod.js";
import {
  ALL_HTML5LIB_FIXTURE_FILES,
  ENCODING_FIXTURE_FILES,
  requireFixtureFiles,
  SERIALIZER_FIXTURE_FILES,
  TOKENIZER_FIXTURE_FILES,
  TREE_FIXTURE_FILES
} from "../../test/support/fixture-sources.mjs";
import { serializeFixtureTokenStream } from "../../tmp/test-runtime/test/support/fixture-serializer.js";
import { expandTreeDatCases, parseTreeDatFixtures } from "../../test/support/tree-dat.mjs";
import { tokenizeFixtureCase } from "../../test/support/tokenizer-fixture-adapter.mjs";
import { writeJson } from "../eval/eval-primitives.mjs";

const HOLDOUT_MOD = 10;
const HOLDOUT_RULE = `hash(id) % ${HOLDOUT_MOD} === 0`;

const encoder = new TextEncoder();

function hashWithMultiplier(fixtureId, multiplier) {
  let hash = 0;
  for (let charIndex = 0; charIndex < fixtureId.length; charIndex += 1) {
    hash = (Math.imul(hash, multiplier) + fixtureId.charCodeAt(charIndex)) >>> 0;
  }
  return hash;
}

function isTokenizerHoldout(fixtureId) {
  return hashWithMultiplier(fixtureId, 33) % HOLDOUT_MOD === 0;
}

function isTreeHoldout(fixtureId) {
  return hashWithMultiplier(fixtureId, 31) % HOLDOUT_MOD === 0;
}

function isEncodingHoldout(fixtureId) {
  return hashWithMultiplier(fixtureId, 29) % HOLDOUT_MOD === 0;
}

function isSerializerHoldout(fixtureId) {
  return hashWithMultiplier(fixtureId, 37) % HOLDOUT_MOD === 0;
}

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
    const name = token.name.length === 0 ? null : token.name;
    return ["DOCTYPE", name, token.publicId, token.systemId, !token.forceQuirks];
  }

  if (token.type === "Character") {
    return ["Character", token.data];
  }

  return null;
}

function normalizeTokenArray(tokens) {
  return tokens
    .map((token) => tokenizerTokenToFixture(token))
    .filter((token) => token !== null)
    .map((token) => fixtureTokenToComparable(token));
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
  const parsedCases = [];
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

  const selectedCases = parsedCases.filter((fixture) => isTokenizerHoldout(fixture.fixtureId));

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const fixtureCase of selectedCases) {
    const tokenizeResult = tokenizeFixtureCase(fixtureCase.input, {
      initialState: fixtureCase.initialState,
      lastStartTag: fixtureCase.lastStartTag,
      doubleEscaped: fixtureCase.doubleEscaped,
      xmlViolationMode: fixtureCase.xmlViolationMode,
      budgets: {
        maxTextBytes: 200000,
        maxTokenBytes: 16000,
        maxParseErrors: 2000,
        maxTimeMs: 50
      }
    });

    const expectedTokens = fixtureCase.output.map((token) => fixtureTokenToComparable(token));
    const actualTokens = normalizeTokenArray(tokenizeResult.tokens);
    const isTokenSequenceMatch = JSON.stringify(expectedTokens) === JSON.stringify(actualTokens);

    if (isTokenSequenceMatch) {
      passed += 1;
      continue;
    }

    failed += 1;
    failures.push({
      suite: "tokenizer",
      id: fixtureCase.id,
      expectedPreview: expectedTokens.slice(0, 8),
      actualPreview: actualTokens.slice(0, 8)
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
    totalSurface: parsedCases.length,
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
        fragmentContextTagName: testCase.fragmentContext?.localName,
        scriptingEnabled: testCase.scriptingEnabled
      }
    );

    const actualTree = normalizeFixtureOutput(normalizeTree(treeBuildResult.document));
    const expectedTree = normalizeFixtureOutput(testCase.expected);

    if (actualTree === expectedTree) {
      passed += 1;
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

  return {
    cases: {
      total: selectedCases.length,
      passed,
      failed,
      skipped: 0
    },
    holdoutRule: HOLDOUT_RULE,
    holdoutMod: HOLDOUT_MOD,
    totalSurface: allTests.length,
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
  const serializerCases = [];
  for (const fixturePath of SERIALIZER_FIXTURE_FILES) {
    const fixtureFile = JSON.parse(await readFile(fixturePath, "utf8"));
    for (let caseIndex = 0; caseIndex < (fixtureFile.tests ?? []).length; caseIndex += 1) {
      const fixtureCase = fixtureFile.tests[caseIndex];
      serializerCases.push({
        id: `${fixturePath}#${caseIndex + 1}`,
        input: fixtureCase.input ?? [],
        expected: Array.isArray(fixtureCase.expected) ? String(fixtureCase.expected[0] ?? "") : "",
        options: fixtureCase.options ?? {}
      });
    }
  }

  const selectedCases = serializerCases.filter((fixture) => isSerializerHoldout(fixture.id));
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const fixtureCase of selectedCases) {
    const actualOutput = serializeFixtureTokenStream(fixtureCase.input, fixtureCase.options);

    if (actualOutput === fixtureCase.expected) {
      passed += 1;
      continue;
    }

    failed += 1;
    failures.push({
      suite: "serializer",
      id: fixtureCase.id,
      expected: fixtureCase.expected,
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
    totalSurface: serializerCases.length,
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

if (cases.failed > 0) {
  console.error(`Holdout hard failures: ${cases.failed}`);
  process.exit(1);
}

console.log(
  `Holdout fixtures passed=${cases.passed}, failed=${cases.failed}, total=${cases.total} `
    + `(tokenizer=${tokenizerHoldout.cases.total}, tree=${treeHoldout.cases.total}, `
    + `encoding=${encodingHoldout.cases.total}, serializer=${serializerHoldout.cases.total})`
);
