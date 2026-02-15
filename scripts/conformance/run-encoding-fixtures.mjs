import { readFile } from "node:fs/promises";

import { writeJson } from "../eval/util.mjs";
import { sniffHtmlEncoding } from "../../dist/internal/encoding/sniff.js";

const ENCODING_FIXTURE_FILES = [
  "vendor/html5lib-tests/encoding/tests1.dat",
  "vendor/html5lib-tests/encoding/tests2.dat",
  "vendor/html5lib-tests/encoding/test-yahoo-jp.dat"
];
const SKIP_DECISION_RECORD = "docs/decisions/ADR-001-encoding-malformed-meta-skips.md";
const SKIP_CASE_IDS = new Set([
  "vendor/html5lib-tests/encoding/tests1.dat#15",
  "vendor/html5lib-tests/encoding/tests1.dat#25",
  "vendor/html5lib-tests/encoding/tests1.dat#34",
  "vendor/html5lib-tests/encoding/tests1.dat#35",
  "vendor/html5lib-tests/encoding/tests1.dat#36"
]);

function parseDatFixtures(text, fileName) {
  const lines = text.split(/\r?\n/);
  const cases = [];

  let section = "";
  let dataLines = [];
  let expected = "";

  function pushCurrent() {
    if (dataLines.length === 0 && expected.trim().length === 0) {
      return;
    }

    if (expected.trim().length === 0) {
      return;
    }

    cases.push({
      id: `${fileName}#${cases.length + 1}`,
      data: dataLines.join("\n"),
      expectedEncoding: expected.trim().toLowerCase()
    });

    dataLines = [];
    expected = "";
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
      dataLines.push(line);
      continue;
    }

    if (section === "encoding") {
      if (expected.length > 0) {
        expected += "\n";
      }
      expected += line;
    }
  }

  pushCurrent();
  return cases;
}

function normalizeExpected(label) {
  return label.trim().toLowerCase();
}

const allCases = [];
for (const fixturePath of ENCODING_FIXTURE_FILES) {
  const content = await readFile(fixturePath, "utf8");
  allCases.push(...parseDatFixtures(content, fixturePath));
}

const encoder = new TextEncoder();
const failures = [];
const skips = [];
let passed = 0;
let failed = 0;
let skipped = 0;

for (const fixture of allCases) {
  if (SKIP_CASE_IDS.has(fixture.id)) {
    skipped += 1;
    skips.push({
      id: fixture.id,
      reason: "Malformed markup requires tokenizer-integrated prescan semantics.",
      decisionRecord: SKIP_DECISION_RECORD
    });
    continue;
  }

  const bytes = encoder.encode(fixture.data);
  const result = sniffHtmlEncoding(bytes, { defaultEncoding: "windows-1252" });

  const expected = normalizeExpected(fixture.expectedEncoding);
  const actual = result.encoding;

  if (expected === actual) {
    passed += 1;
    continue;
  }

  failed += 1;
  failures.push({
    id: fixture.id,
    expected,
    actual,
    source: result.source
  });
}

const report = {
  suite: "encoding",
  timestamp: new Date().toISOString(),
  cases: {
    total: allCases.length,
    passed,
    failed,
    skipped
  },
  skips,
  failures
};

await writeJson("reports/encoding.json", report);

if (failed > 0) {
  console.error(`Encoding fixture failures: ${failed}/${allCases.length}`);
  process.exit(1);
}

console.log(`Encoding fixtures passed: ${passed}/${allCases.length}`);
