import { readFile } from "node:fs/promises";

import { writeJson } from "../eval/eval-primitives.mjs";
import { sniffHtmlEncoding } from "../../dist/internal/encoding/sniff.js";

const ENCODING_FIXTURE_FILES = [
  "vendor/html5lib-tests/encoding/tests1.dat",
  "vendor/html5lib-tests/encoding/tests2.dat",
  "vendor/html5lib-tests/encoding/test-yahoo-jp.dat"
];
const HOLDOUT_MOD = 10;
const HOLDOUT_RULE = `hash(id) % ${HOLDOUT_MOD} === 0`;

function computeHoldout(fixtureId) {
  let hash = 0;
  for (let charIndex = 0; charIndex < fixtureId.length; charIndex += 1) {
    hash = (Math.imul(hash, 29) + fixtureId.charCodeAt(charIndex)) >>> 0;
  }
  return hash % HOLDOUT_MOD === 0;
}

function parseDatFixtures(text, fixtureFilePath) {
  const lines = text.split(/\r?\n/);
  const parsedFixtureCases = [];

  let section = "";
  let inputDataLines = [];
  let expectedEncodingLabel = "";

  function pushCurrent() {
    if (inputDataLines.length === 0 && expectedEncodingLabel.trim().length === 0) {
      return;
    }

    if (expectedEncodingLabel.trim().length === 0) {
      return;
    }

    parsedFixtureCases.push({
      id: `${fixtureFilePath}#${parsedFixtureCases.length + 1}`,
      data: inputDataLines.join("\n"),
      expectedEncoding: expectedEncodingLabel.trim().toLowerCase()
    });

    inputDataLines = [];
    expectedEncodingLabel = "";
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
      inputDataLines.push(line);
      continue;
    }

    if (section === "encoding") {
      if (expectedEncodingLabel.length > 0) {
        expectedEncodingLabel += "\n";
      }
      expectedEncodingLabel += line;
    }
  }

  pushCurrent();
  return parsedFixtureCases;
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

for (const fixtureCase of allCases) {
  if (computeHoldout(fixtureCase.id)) {
    holdoutExcluded += 1;
    continue;
  }

  const encodedBytes = encoder.encode(fixtureCase.data);
  const sniffResult = sniffHtmlEncoding(encodedBytes, { defaultEncoding: "windows-1252" });

  const expectedEncoding = normalizeExpected(fixtureCase.expectedEncoding);
  const actualEncoding = sniffResult.encoding;

  if (expectedEncoding === actualEncoding) {
    passed += 1;
    continue;
  }

  failed += 1;
  failures.push({
    id: fixtureCase.id,
    expected: expectedEncoding,
    actual: actualEncoding,
    source: sniffResult.source
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
  console.error(`EVAL: Encoding fixture failures: ${failed}/${allCases.length - holdoutExcluded}`);
  process.exit(1);
}

console.log(`ACT: Encoding fixtures passed=${passed}/${allCases.length - holdoutExcluded}`);
