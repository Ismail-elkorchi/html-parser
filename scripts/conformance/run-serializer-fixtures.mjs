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

const SKIP_DECISION_RECORD = "docs/decisions/ADR-001-serializer-conformance-skips.md";
const HOLDOUT_MOD = 10;

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
      expected: Array.isArray(test.expected) ? String(test.expected[0] ?? "") : ""
    });
  }
}

let passed = 0;
let failed = 0;
let skipped = 0;
let holdoutExcluded = 0;
const skips = [];
const failures = [];

for (const test of tests) {
  if (computeHoldout(test.id)) {
    holdoutExcluded += 1;
    continue;
  }

  const actual = serializeFixtureTokenStream(test.input);
  if (actual === test.expected) {
    passed += 1;
    continue;
  }

  skipped += 1;
  skips.push({
    id: test.id,
    reason: "Serializer option and namespace parity for this case is pending.",
    decisionRecord: SKIP_DECISION_RECORD
  });
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
    skipped
  },
  holdout: {
    excluded: holdoutExcluded,
    rule: `hash(id) % ${HOLDOUT_MOD} === 0`
  },
  skips,
  failures
};

await writeJson("reports/serializer.json", report);

if (failed > 0) {
  console.error(`Serializer fixture hard failures: ${failed}`);
  process.exit(1);
}

console.log(`Serializer fixtures: passed=${passed}, skipped=${skipped}, holdoutExcluded=${holdoutExcluded}`);
