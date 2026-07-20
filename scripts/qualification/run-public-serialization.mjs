import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { HTML_NAMESPACE_URI, parseFragment, serialize } from "../../dist/mod.js";

import {
  PUBLIC_SERIALIZATION_QUALIFICATION_CASES,
  REQUIRED_SERIALIZATION_FEATURES,
  WPT_SERIALIZING_OUTER_EXPECTATIONS,
  WPT_OUTER_HTML_ELEMENTS,
  WPT_OUTER_HTML_VOID_ELEMENTS,
  runPublicSerializationQualificationCase
} from "../../test/support/public-serialization-qualification-cases.mjs";
import { verifyWptSerializationCorpus } from "../../test/support/wpt-serialization-corpus.mjs";
import { writeJson } from "../eval/eval-primitives.mjs";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function reportPath() {
  const prefix = "--report=";
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ??
    "reports/public-serialization.json";
}

function readStaticStringArray(sourceText, declarationName) {
  const match = new RegExp(`(?:const|var) ${declarationName} = \\[([\\s\\S]*?)\\];`).exec(sourceText);
  if (match === null) throw new Error(`cannot find ${declarationName} in pinned WPT dependency`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

const corpus = await verifyWptSerializationCorpus();
const HTML_DIV_CONTEXT = Object.freeze({ namespaceUri: HTML_NAMESPACE_URI, localName: "div" });
const failures = [];
const outcomes = [];
const observedFeatures = new Set();
const observedWptFiles = new Set();
const manifestFiles = new Set(
  corpus.manifest.files
    .filter((file) => file.kind === "fixture")
    .map((file) => file.path.slice("files/".length))
);
const commonSource = await readFile(
  `${corpus.corpusRoot}/dependencies/html-common.js`,
  "utf8"
);
const pinnedElements = readStaticStringArray(commonSource, "HTML5_ELEMENTS");
const pinnedVoidElements = readStaticStringArray(commonSource, "HTML5_VOID_ELEMENTS");
if (JSON.stringify(pinnedElements) !== JSON.stringify(WPT_OUTER_HTML_ELEMENTS)) {
  failures.push({ reason: "outerhtml-element-inventory-mismatch" });
}
if (JSON.stringify(pinnedVoidElements) !== JSON.stringify(WPT_OUTER_HTML_VOID_ELEMENTS)) {
  failures.push({ reason: "outerhtml-void-inventory-mismatch" });
}
const serializingSource = await readFile(`${corpus.corpusRoot}/files/serializing.html`, "utf8");
const expectedMatch = /var expected = (\[[\s\S]*?\n\]);/.exec(serializingSource);
if (expectedMatch === null) throw new Error("cannot find expected array in pinned WPT serializing.html");
const pinnedExpected = vm.runInNewContext(`(${expectedMatch[1]})`, Object.create(null));
const pinnedOuterExpectations = pinnedExpected.map((entry) => entry[1]);
if (JSON.stringify(pinnedOuterExpectations) !== JSON.stringify(WPT_SERIALIZING_OUTER_EXPECTATIONS)) {
  failures.push({ reason: "serializing-outer-expectation-inventory-mismatch" });
}

for (const testCase of PUBLIC_SERIALIZATION_QUALIFICATION_CASES) {
  const actual = runPublicSerializationQualificationCase(testCase);
  for (const feature of testCase.features) observedFeatures.add(feature);
  if (testCase.source !== undefined) {
    observedWptFiles.add(testCase.source.file);
    if (!manifestFiles.has(testCase.source.file)) {
      failures.push({ id: testCase.id, reason: "unknown-wpt-source", file: testCase.source.file });
    }
  }
  outcomes.push({ id: testCase.id, actualSha256: sha256(actual) });
  if (actual !== testCase.expected) {
    failures.push({ id: testCase.id, reason: "serialization-mismatch", expected: testCase.expected, actual });
  }
}

const parsedWptOutcomes = [];
for (let index = 0; index < WPT_SERIALIZING_OUTER_EXPECTATIONS.length; index += 1) {
  const expected = WPT_SERIALIZING_OUTER_EXPECTATIONS[index];
  const fragment = parseFragment(expected, HTML_DIV_CONTEXT);
  const node = fragment.children[0];
  const actual = node === undefined ? "" : serialize(node);
  const id = `serializing.html#outerHTML-${String(index)}`;
  parsedWptOutcomes.push({ id, actualSha256: sha256(actual) });
  if (actual !== expected) failures.push({ id, reason: "parsed-wpt-outer-mismatch", expected, actual });
}

for (const feature of REQUIRED_SERIALIZATION_FEATURES) {
  if (!observedFeatures.has(feature)) failures.push({ reason: "missing-feature", feature });
}
const requiredWptFiles = corpus.manifest.files
  .filter((file) => file.kind === "fixture" && file.applicability.status !== "inapplicable")
  .map((file) => file.path.slice("files/".length));
for (const file of requiredWptFiles) {
  if (!observedWptFiles.has(file)) failures.push({ reason: "unobserved-applicable-wpt-file", file });
}

const report = {
  schema: "public-serialization-qualification/v1",
  generatedAt: new Date().toISOString(),
  implementation: "dist/mod.js#serialize",
  standardRevision: "56674fb3ac40279141a202e5d19b84f30d99854d",
  corpus: {
    commit: corpus.manifest.commit,
    compositeSha256: corpus.compositeSha256,
    statistics: corpus.manifest.statistics
  },
  cases: {
    total: PUBLIC_SERIALIZATION_QUALIFICATION_CASES.length + WPT_SERIALIZING_OUTER_EXPECTATIONS.length,
    direct: PUBLIC_SERIALIZATION_QUALIFICATION_CASES.length,
    parsedWptOuter: WPT_SERIALIZING_OUTER_EXPECTATIONS.length,
    failed: failures.filter((failure) =>
      failure.reason === "serialization-mismatch" || failure.reason === "parsed-wpt-outer-mismatch"
    ).length
  },
  requiredFeatures: REQUIRED_SERIALIZATION_FEATURES,
  observedWptFiles: [...observedWptFiles].sort(),
  inapplicableWptFiles: corpus.manifest.files
    .filter((file) => file.kind === "fixture" && file.applicability.status === "inapplicable")
    .map((file) => ({ file: file.path.slice("files/".length), reason: file.applicability.reason })),
  outcomesSha256: sha256({ direct: outcomes, parsedWptOutcomes }),
  failures
};
await writeJson(reportPath(), report);
console.log(JSON.stringify(report));
if (failures.length > 0) process.exitCode = 1;
