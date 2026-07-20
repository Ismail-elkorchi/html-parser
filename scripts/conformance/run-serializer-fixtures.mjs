import {
  PUBLIC_SERIALIZER_CASES,
  runPublicSerializerCase
} from "../../test/support/public-serializer-cases.mjs";
import { writeJson } from "../lib/report.mjs";

let passed = 0;
let failed = 0;
const failures = [];

for (const testCase of PUBLIC_SERIALIZER_CASES) {
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
  suite: "html-parser-public-serializer",
  implementation: "dist/mod.js#serialize",
  generatedAt: new Date().toISOString(),
  cases: { total: passed + failed, passed, failed, skipped: 0 },
  skips: [],
  failures
});

if (failed > 0) process.exitCode = 1;
console.log(`Public serializer passed=${String(passed)}, failed=${String(failed)}`);
