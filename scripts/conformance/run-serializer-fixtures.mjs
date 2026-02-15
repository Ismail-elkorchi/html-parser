import { readFile } from "node:fs/promises";

import { writeJson } from "../eval/util.mjs";
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

function computeHoldout(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (Math.imul(hash, 37) + id.charCodeAt(i)) >>> 0;
  }
  return hash % HOLDOUT_MOD === 0;
}

const tests = [];
for (const file of SERIALIZER_FILES) {
  const raw = JSON.parse(await readFile(file, "utf8"));
  for (let index = 0; index < (raw.tests ?? []).length; index += 1) {
    const test = raw.tests[index];
    tests.push({
      id: `${file}#${index + 1}`,
      input: test.input ?? [],
      expected: Array.isArray(test.expected) ? String(test.expected[0] ?? "") : "",
      options: test.options ?? {}
    });
  }
}

let passed = 0;
let failed = 0;
let holdoutExcluded = 0;
const failures = [];

for (const test of tests) {
  if (computeHoldout(test.id)) {
    holdoutExcluded += 1;
    continue;
  }

  const actual = serializeFixtureTokenStream(test.input, test.options);
  if (actual === test.expected) {
    passed += 1;
    continue;
  }

  failed += 1;
  failures.push({
    id: test.id,
    expected: test.expected,
    actual
  });
}

const report = {
  suite: "serializer",
  timestamp: new Date().toISOString(),
  cases: {
    total: tests.length - holdoutExcluded,
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
  console.error(`Serializer fixture hard failures: ${failed}`);
  process.exit(1);
}

console.log(`Serializer fixtures: passed=${passed}, failed=${failed}, holdoutExcluded=${holdoutExcluded}`);
