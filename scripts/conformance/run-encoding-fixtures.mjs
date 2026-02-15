import { readFile } from "node:fs/promises";

import { writeJson } from "../eval/util.mjs";
import { sniffHtmlEncoding } from "../../dist/internal/encoding/sniff.js";

const ENCODING_FIXTURE_FILES = [
  "vendor/html5lib-tests/encoding/tests1.dat",
  "vendor/html5lib-tests/encoding/tests2.dat",
  "vendor/html5lib-tests/encoding/test-yahoo-jp.dat"
];
const HOLDOUT_MOD = 10;
const HOLDOUT_RULE = `hash(id) % ${HOLDOUT_MOD} === 0`;

function computeHoldout(id) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (Math.imul(hash, 29) + id.charCodeAt(index)) >>> 0;
  }
  return hash % HOLDOUT_MOD === 0;
}

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
let passed = 0;
let failed = 0;
let holdoutExcluded = 0;

for (const fixture of allCases) {
  if (computeHoldout(fixture.id)) {
    holdoutExcluded += 1;
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
    total: allCases.length - holdoutExcluded,
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

await writeJson("reports/encoding.json", report);

if (failed > 0) {
  console.error(`Encoding fixture failures: ${failed}/${allCases.length - holdoutExcluded}`);
  process.exit(1);
}

console.log(`Encoding fixtures passed: ${passed}/${allCases.length - holdoutExcluded}`);
