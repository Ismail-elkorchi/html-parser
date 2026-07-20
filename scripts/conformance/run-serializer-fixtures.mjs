import {
  PUBLIC_SERIALIZER_CASES,
  isPublicSerializerHoldout,
  runPublicSerializerCase
} from "../../test/support/public-serializer-cases.mjs";
import { writeJson } from "../eval/eval-primitives.mjs";

const HOLDOUT_RULE = "hash(id) % 10 === 0";
let passed = 0;
let failed = 0;
let holdoutExcluded = 0;
const failures = [];

for (const testCase of PUBLIC_SERIALIZER_CASES) {
  if (isPublicSerializerHoldout(testCase.id)) {
    holdoutExcluded += 1;
    continue;
  }
  const actual = runPublicSerializerCase(testCase);
  if (actual === testCase.expected) {
    passed += 1;
  } else {
    failed += 1;
    failures.push({ id: testCase.id, expected: testCase.expected, actual });
  }
}

await writeJson("reports/serializer.json", {
  schemaVersion: 2,
  suite: "public-html-serializer",
  implementation: "dist/mod.js#serialize",
  timestamp: new Date().toISOString(),
  cases: { total: passed + failed, passed, failed, skipped: 0 },
  holdout: {
    excluded: holdoutExcluded,
    rule: HOLDOUT_RULE,
    mod: 10
  },
  holdoutExcluded,
  holdoutRule: HOLDOUT_RULE,
  holdoutMod: 10,
  skips: [],
  failures
});

if (failed > 0) process.exitCode = 1;
console.log(
  `Public serializer passed=${String(passed)}, failed=${String(failed)}, ` +
  `holdoutExcluded=${String(holdoutExcluded)}`
);
