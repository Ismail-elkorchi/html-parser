import { readFile } from "node:fs/promises";

import { writeJson } from "../eval/eval-primitives.mjs";
import { serializeFixtureTokenStream } from "../../dist/internal/serializer/mod.js";

const SERIALIZER_FILES = [
  "vendor/html5lib-tests/serializer/core.test",
  "vendor/html5lib-tests/serializer/options.test",
  "vendor/html5lib-tests/serializer/whitespace.test",
  "vendor/html5lib-tests/serializer/optionaltags.test",
  "vendor/html5lib-tests/serializer/injectmeta.test"
];

const HOLDOUT_MOD = 10;
const HOLDOUT_RULE = `hash(id) % ${HOLDOUT_MOD} === 0`;

function computeHoldout(fixtureId) {
  let hash = 0;
  for (let charIndex = 0; charIndex < fixtureId.length; charIndex += 1) {
    hash = (Math.imul(hash, 37) + fixtureId.charCodeAt(charIndex)) >>> 0;
  }
  return hash % HOLDOUT_MOD === 0;
}

const serializerCases = [];
for (const fixturePath of SERIALIZER_FILES) {
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

let passed = 0;
let failed = 0;
let holdoutExcluded = 0;
const failures = [];

for (const fixtureCase of serializerCases) {
  if (computeHoldout(fixtureCase.id)) {
    holdoutExcluded += 1;
    continue;
  }

  const actualOutput = serializeFixtureTokenStream(fixtureCase.input, fixtureCase.options);
  if (actualOutput === fixtureCase.expected) {
    passed += 1;
    continue;
  }

  failed += 1;
  failures.push({
    id: fixtureCase.id,
    expected: fixtureCase.expected,
    actual: actualOutput
  });
}

const report = {
  suite: "serializer",
  timestamp: new Date().toISOString(),
  cases: {
    total: serializerCases.length - holdoutExcluded,
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

await writeJson("reports/serializer.json", report);

if (failed > 0) {
  console.error(`EVAL: Serializer fixture hard failures: ${failed}`);
  process.exit(1);
}

console.log(`ACT: Serializer fixtures passed=${passed}, failed=${failed}, holdoutExcluded=${holdoutExcluded}`);
