import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { runIndependentBlackBoxFixture } from "../legacy/run-black-box.mjs";
import { writeJson } from "../eval/eval-primitives.mjs";

const CLASSIFICATION_PATH = "test/fixtures/qualification/legacy-black-box-classifications.json";
const REPORT_PATH = "reports/engine-legacy-differential.json";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function functionalProjection(outcome) {
  if (outcome.status !== "returned") return outcome;
  const projected = globalThis.structuredClone(outcome);
  const value = projected.value;
  if (value?.tree !== undefined) {
    delete value.tree.errors;
    delete value.tree.trace;
    if (value.metadata?.resourceUsage !== undefined) {
      delete value.metadata.resourceUsage.parseErrors;
      delete value.metadata.resourceUsage.traceEvents;
      delete value.metadata.resourceUsage.traceUtf8Bytes;
    }
  } else {
    delete value.errors;
    delete value.trace;
  }
  return projected;
}

const policy = JSON.parse(await readFile(CLASSIFICATION_PATH, "utf8"));
if (policy.schemaVersion !== 1 || !Array.isArray(policy.entries)) {
  throw new Error("Legacy differential classifications must use schemaVersion 1 and contain entries");
}
const fixture = JSON.parse(await readFile(policy.fixture, "utf8"));
const baseline = JSON.parse(await readFile(policy.baseline, "utf8"));
const candidate = await runIndependentBlackBoxFixture(fixture);
const baselineById = new Map(baseline.cases.map((entry) => [entry.id, entry]));
const expectedClassifications = new Map(policy.entries.map((entry) => [entry.id, entry]));
if (expectedClassifications.size !== policy.entries.length) {
  throw new Error("Legacy differential classifications contain duplicate case ids");
}

const exact = [];
const classified = [];
const unexpected = [];
const functionalRegressions = [];
for (const outcome of candidate.cases) {
  const expected = baselineById.get(outcome.id);
  if (expected === undefined) {
    unexpected.push({ id: outcome.id, reason: "missing-baseline-case" });
    continue;
  }
  baselineById.delete(outcome.id);
  const expectedSha256 = sha256(expected);
  const candidateSha256 = sha256(outcome);
  if (expectedSha256 === candidateSha256) {
    exact.push({ id: outcome.id, sha256: candidateSha256 });
    continue;
  }
  if (sha256(functionalProjection(outcome)) !== sha256(functionalProjection(expected))) {
    functionalRegressions.push({ id: outcome.id, expectedSha256, candidateSha256 });
  }
  const classification = expectedClassifications.get(outcome.id);
  if (
    classification === undefined ||
    classification.expectedSha256 !== expectedSha256 ||
    classification.candidateSha256 !== candidateSha256
  ) {
    unexpected.push({ id: outcome.id, expectedSha256, candidateSha256 });
    continue;
  }
  classified.push({
    id: outcome.id,
    expectedSha256,
    candidateSha256,
    classification: classification.classification,
    reason: classification.reason
  });
  expectedClassifications.delete(outcome.id);
}

const report = {
  schemaVersion: 1,
  suite: "independent-engine-legacy-black-box-differential",
  generatedAt: new Date().toISOString(),
  fixtureSha256: sha256(fixture),
  baselineSha256: sha256(baseline),
  cases: candidate.cases.length,
  exact: exact.length,
  classified: classified.length,
  functionalContractExact: candidate.cases.length - functionalRegressions.length,
  functionalRegressions,
  unexpected,
  missingBaselineCases: [...baselineById.keys()],
  unobservedClassifications: [...expectedClassifications.keys()],
  classifications: classified
};
await writeJson(REPORT_PATH, report);
console.log(JSON.stringify(report, null, 2));

if (
  functionalRegressions.length > 0 ||
  unexpected.length > 0 ||
  baselineById.size > 0 ||
  expectedClassifications.size > 0 ||
  exact.length + classified.length !== candidate.cases.length
) {
  process.exitCode = 1;
}
