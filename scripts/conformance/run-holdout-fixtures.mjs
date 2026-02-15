import { readFile } from "node:fs/promises";

import { tokenize } from "../../dist/internal/tokenizer/mod.js";
import { writeJson } from "../eval/util.mjs";

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
const HOLDOUT_LIMIT = 256;

function computeHoldout(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (Math.imul(hash, 33) + id.charCodeAt(i)) >>> 0;
  }
  return hash % HOLDOUT_MOD === 0;
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

const selected = [];
for (const file of TOKENIZER_FILES) {
  const raw = JSON.parse(await readFile(file, "utf8"));
  const tests = raw.tests ?? raw.xmlViolationTests ?? [];
  for (let index = 0; index < tests.length; index += 1) {
    const fixture = tests[index];
    const id = `${file}#${index + 1}`;
    if (!computeHoldout(id)) {
      continue;
    }
    selected.push({
      id,
      file,
      input: fixture.input ?? "",
      output: fixture.output ?? [],
      initialStates: fixture.initialStates ?? ["Data state"],
      lastStartTag: fixture.lastStartTag,
      doubleEscaped: fixture.doubleEscaped ?? false
    });
  }
}

selected.sort((left, right) => left.id.localeCompare(right.id));
const holdoutCases = [];
for (const fixture of selected.slice(0, HOLDOUT_LIMIT)) {
  for (const initialState of fixture.initialStates) {
    holdoutCases.push({
      id: `${fixture.id}@${initialState}`,
      input: fixture.input,
      output: fixture.output,
      initialState,
      lastStartTag: fixture.lastStartTag,
      doubleEscaped: fixture.doubleEscaped,
      xmlViolationMode: fixture.file.endsWith("xmlViolation.test")
    });
  }
}

let passed = 0;
let failed = 0;
const failures = [];

for (const fixture of holdoutCases) {
  const result = tokenize(fixture.input, {
    initialState: fixture.initialState,
    lastStartTag: fixture.lastStartTag,
    doubleEscaped: fixture.doubleEscaped,
    xmlViolationMode: fixture.xmlViolationMode,
    budgets: {
      maxTextBytes: 200000,
      maxTokenBytes: 16000,
      maxParseErrors: 2000,
      maxTimeMs: 100
    }
  });

  const expected = fixture.output.map((token) => fixtureTokenToComparable(token));
  const actual = normalizeTokenArray(result.tokens);
  if (JSON.stringify(expected) === JSON.stringify(actual)) {
    passed += 1;
    continue;
  }

  failed += 1;
  failures.push({
    id: fixture.id,
    expectedPreview: expected.slice(0, 8),
    actualPreview: actual.slice(0, 8)
  });
}

await writeJson("reports/holdout.json", {
  suite: "holdout",
  timestamp: new Date().toISOString(),
  artifact: {
    dataset: "html5lib-tests/tokenizer",
    selectionRule: `hash(id) % ${HOLDOUT_MOD} === 0`,
    selected: selected.slice(0, HOLDOUT_LIMIT).length,
    expandedCases: holdoutCases.length,
    limit: HOLDOUT_LIMIT
  },
  cases: {
    total: holdoutCases.length,
    passed,
    failed,
    skipped: 0
  },
  skips: [],
  failures
});

if (failed > 0) {
  console.error(`Holdout hard failures: ${failed}`);
  process.exit(1);
}

console.log(`Holdout fixtures: passed=${passed}, failed=${failed}`);
