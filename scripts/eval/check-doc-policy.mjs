import { readFile } from "node:fs/promises";

import { nowIso, writeJson } from "./eval-primitives.mjs";

const CANONICAL_PATH = "docs/naming-conventions.md";
const REFERENCE_PATH = "CONTRIBUTING.md";
const CANONICAL_MARKER_PREFIX = "Canonical policy marker:";
const CANONICAL_LINK = "docs/naming-conventions.md";
const PROHIBITION_PHRASE = "Uppercase tag prefixes (`CUE:`, `ACT:`, `EVAL:`) are prohibited.";
const PROHIBITED_PREFIX_PATTERN = /(?:CUE:|ACT:|EVAL:)/;

function checkId(id, ok, details = {}) {
  return { id, ok, ...details };
}

function extractCanonicalMarkers(content) {
  const matches = content.match(/^Canonical policy marker:\s*(LOG_LABEL_POLICY=[A-Z0-9_]+)\s*$/gm) || [];
  return matches.map((line) => line.slice(CANONICAL_MARKER_PREFIX.length).trim());
}

function extractReferenceMarkers(content) {
  const markerRegex = /Policy reference marker:\s*(LOG_LABEL_POLICY=[A-Z0-9_]+)\s*\(canonical:\s*docs\/naming-conventions\.md\)/g;
  const markers = [];
  let match = markerRegex.exec(content);
  while (match) {
    markers.push(match[1]);
    match = markerRegex.exec(content);
  }
  return markers;
}

async function main() {
  const namingDoc = await readFile(CANONICAL_PATH, "utf8");
  const contributingDoc = await readFile(REFERENCE_PATH, "utf8");

  const checks = [];

  const canonicalMarkers = extractCanonicalMarkers(namingDoc);
  checks.push(
    checkId("canonical-marker-singleton", canonicalMarkers.length === 1, {
      expected: 1,
      observed: canonicalMarkers.length
    })
  );

  const referenceMarkers = extractReferenceMarkers(contributingDoc);
  checks.push(
    checkId("reference-marker-singleton", referenceMarkers.length === 1, {
      expected: 1,
      observed: referenceMarkers.length
    })
  );

  const canonicalMarker = canonicalMarkers[0] || null;
  const referenceMarker = referenceMarkers[0] || null;
  checks.push(
    checkId("reference-matches-canonical", canonicalMarker !== null && canonicalMarker === referenceMarker, {
      canonicalMarker,
      referenceMarker
    })
  );

  checks.push(
    checkId("canonical-link-present", contributingDoc.includes(CANONICAL_LINK), {
      canonicalLink: CANONICAL_LINK
    })
  );

  checks.push(
    checkId("explicit-prohibition-phrase", namingDoc.includes(PROHIBITION_PHRASE), {
      phrase: PROHIBITION_PHRASE
    })
  );

  checks.push(
    checkId("contributing-has-no-tag-prefix-examples", !PROHIBITED_PREFIX_PATTERN.test(contributingDoc), {
      prohibitedPattern: PROHIBITED_PREFIX_PATTERN.source
    })
  );

  const failures = checks.filter((check) => !check.ok);
  const report = {
    suite: "doc-policy",
    timestamp: nowIso(),
    ok: failures.length === 0,
    canonicalPath: CANONICAL_PATH,
    referencePath: REFERENCE_PATH,
    checks,
    failures
  };

  await writeJson("reports/doc-policy.json", report);

  if (report.ok) {
    return;
  }

  console.error("Doc policy check failed:");
  for (const failure of failures) {
    console.error(`- ${failure.id}`);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
