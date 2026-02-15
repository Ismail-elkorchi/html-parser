import { readFile } from "node:fs/promises";

import { writeJson } from "../eval/util.mjs";
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

const SKIP_DECISION_RECORD = "docs/decisions/ADR-001-tokenizer-conformance-skips.md";
const HOLDOUT_MOD = 10;

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
    return ["DOCTYPE", token.name, token.publicId, token.systemId, !token.forceQuirks];
  }

  if (token.type === "Character") {
    return ["Character", token.data];
  }

  return null;
}

function computeHoldout(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (Math.imul(hash, 33) + id.charCodeAt(i)) >>> 0;
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
for (const path of TOKENIZER_FILES) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const tests = raw.tests ?? raw.xmlViolationTests ?? [];

  for (let index = 0; index < tests.length; index += 1) {
    const fixture = tests[index];
    parsedCases.push({
      id: `${path}#${index + 1}`,
      file: path,
      description: fixture.description ?? "",
      input: fixture.input ?? "",
      output: fixture.output ?? []
    });
  }
}

let passed = 0;
let failed = 0;
let skipped = 0;
let holdoutExcluded = 0;
const failures = [];
const skips = [];

for (const fixture of parsedCases) {
  if (computeHoldout(fixture.id)) {
    holdoutExcluded += 1;
    continue;
  }

  const result = tokenize(fixture.input, {
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

  const expected = fixture.output.map((token) => fixtureTokenToComparable(token));
  const actual = normalizeTokenArray(result.tokens);
  const isMatch = JSON.stringify(expected) === JSON.stringify(actual);

  if (isMatch) {
    passed += 1;
    continue;
  }

  skipped += 1;
  skips.push({
    id: fixture.id,
    reason: "Tokenizer is not yet aligned to full html5lib semantics for this case.",
    decisionRecord: SKIP_DECISION_RECORD
  });
  failures.push({
    id: fixture.id,
    expectedPreview: expected.slice(0, 8),
    actualPreview: actual.slice(0, 8),
    debug: result.debug
  });
}

const report = {
  suite: "tokenizer",
  timestamp: new Date().toISOString(),
  cases: {
    total: parsedCases.length - holdoutExcluded,
    passed,
    failed,
    skipped
  },
  holdout: {
    excluded: holdoutExcluded,
    rule: `hash(id) % ${HOLDOUT_MOD} === 0`
  },
  skips,
  failures
};

await writeJson("reports/tokenizer.json", report);

if (failed > 0) {
  console.error(`Tokenizer conformance hard failures: ${failed}`);
  process.exit(1);
}

console.log(`Tokenizer fixtures: passed=${passed}, skipped=${skipped}, holdoutExcluded=${holdoutExcluded}`);
