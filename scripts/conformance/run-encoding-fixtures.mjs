import { readFile } from "node:fs/promises";

import { sniffHtmlEncoding } from "../../dist/internal/encoding/sniff.js";
import {
  ENCODING_FIXTURES,
  verifyHtml5libCorpora
} from "../../test/support/html5lib-corpora.mjs";
import { writeJson } from "../lib/report.mjs";

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
await verifyHtml5libCorpora();
for (const fixture of ENCODING_FIXTURES) {
  const content = await readFile(fixture.path, "utf8");
  allCases.push(...parseDatFixtures(content, fixture.upstreamPath));
}

const encoder = new TextEncoder();
const failures = [];
let passed = 0;
let failed = 0;

for (const fixtureCase of allCases) {
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
  schemaVersion: 1,
  suite: "html-parser-encoding-conformance",
  generatedAt: new Date().toISOString(),
  cases: {
    total: allCases.length,
    passed,
    failed,
    skipped: 0
  },
  skips: [],
  failures
};

await writeJson("reports/encoding.json", report);

if (failed > 0) {
  console.error(`Encoding fixture failures: ${String(failed)}/${String(allCases.length)}`);
  process.exit(1);
}

console.log(`Encoding fixtures passed=${String(passed)}/${String(allCases.length)}`);
