import { readFile } from "node:fs/promises";

import { writeJson } from "../eval/eval-primitives.mjs";
import { tokenize } from "../../dist/internal/tokenizer/mod.js";

const TOKENIZER_FILES = [
  "vendor/html5lib-tests/tokenizer/test1.test",
  "vendor/html5lib-tests/tokenizer/test2.test",
  "vendor/html5lib-tests/tokenizer/test3.test",
  "vendor/html5lib-tests/tokenizer/test4.test",
  "vendor/html5lib-tests/tokenizer/entities.test",
  "vendor/html5lib-tests/tokenizer/namedEntities.test",
  "vendor/html5lib-tests/tokenizer/numericEntities.test",
  "vendor/html5lib-tests/tokenizer/unicodeChars.test",
  "vendor/html5lib-tests/tokenizer/unicodeCharsProblematic.test",
  "vendor/html5lib-tests/tokenizer/domjs.test",
  "vendor/html5lib-tests/tokenizer/escapeFlag.test",
  "vendor/html5lib-tests/tokenizer/contentModelFlags.test",
  "vendor/html5lib-tests/tokenizer/xmlViolation.test"
];

const HOLDOUT_MOD = 10;
const HOLDOUT_RULE = `hash(id) % ${HOLDOUT_MOD} === 0`;

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

function computeHoldout(fixtureId) {
  let hash = 0;
  for (let charIndex = 0; charIndex < fixtureId.length; charIndex += 1) {
    hash = (Math.imul(hash, 33) + fixtureId.charCodeAt(charIndex)) >>> 0;
  }
  return hash % HOLDOUT_MOD === 0;
}

function normalizeTokenArray(tokens) {
  return tokens
    .map((token) => tokenizerTokenToFixture(token))
    .filter((token) => token !== null)
    .map((token) => fixtureTokenToComparable(token));
}

const parsedCases = [];
for (const fixturePath of TOKENIZER_FILES) {
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

for (const fixtureCase of parsedCases) {
  if (computeHoldout(fixtureCase.fixtureId)) {
    holdoutExcluded += 1;
    continue;
  }

  const tokenizeResult = tokenize(fixtureCase.input, {
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

  const expectedTokens = fixtureCase.output.map((token) => fixtureTokenToComparable(token));
  const actualTokens = normalizeTokenArray(tokenizeResult.tokens);
  const isTokenSequenceMatch = JSON.stringify(expectedTokens) === JSON.stringify(actualTokens);

  if (isTokenSequenceMatch) {
    passed += 1;
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

const report = {
  suite: "tokenizer",
  timestamp: new Date().toISOString(),
  cases: {
    total: parsedCases.length - holdoutExcluded,
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
  failures
};

await writeJson("reports/tokenizer.json", report);

if (failed > 0) {
  console.error(`Tokenizer conformance hard failures: ${failed}`);
  process.exit(1);
}

console.log(`Tokenizer fixtures passed=${passed}, failed=${failed}, holdoutExcluded=${holdoutExcluded}`);
