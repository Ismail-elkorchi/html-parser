import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildTreeFromHtml, normalizeTree } from "../../dist/internal/tree/mod.js";
import {
  requireFixtureFiles,
  TREE_FIXTURE_FILES
} from "../../test/support/fixture-sources.mjs";
import { expandTreeDatCases, parseTreeDatFixtures } from "../../test/support/tree-dat.mjs";
import { writeJson } from "../eval/eval-primitives.mjs";

const HOLDOUT_MOD = 10;
const HOLDOUT_RULE = `hash(id) % ${HOLDOUT_MOD} === 0`;
const DIVERGENCE_LIMIT = 25;

function computeHoldout(fixtureId) {
  let hash = 0;
  for (let charIndex = 0; charIndex < fixtureId.length; charIndex += 1) {
    hash = (Math.imul(hash, 31) + fixtureId.charCodeAt(charIndex)) >>> 0;
  }
  return hash % HOLDOUT_MOD === 0;
}

function normalizeFixtureOutput(value) {
  return value.trimEnd();
}

async function writeDivergenceRecord(caseId, inputHtml, expectedTree, actualTree) {
  const sanitized = caseId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join("reports", "triage", "tree", `${sanitized}.md`);
  const body = [
    "# Tree divergence",
    "",
    `Case: ${caseId}`,
    "",
    "## Input",
    "```html",
    inputHtml,
    "```",
    "",
    "## Expected",
    "```text",
    expectedTree,
    "```",
    "",
    "## Actual",
    "```text",
    actualTree,
    "```"
  ].join("\n");

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${body}\n`, "utf8");
}

const allTests = [];
await requireFixtureFiles(TREE_FIXTURE_FILES);
for (const fixturePath of TREE_FIXTURE_FILES) {
  const fixtureData = await readFile(fixturePath, "utf8");
  const baseCases = parseTreeDatFixtures(fixtureData, fixturePath);
  allTests.push(...expandTreeDatCases(baseCases, {
    unspecifiedModes: [true],
    includeModeInId: false
  }));
}

let passed = 0;
let failed = 0;
let holdoutExcluded = 0;
let divergenceCreated = 0;
const failures = [];

for (const testCase of allTests) {
  if (computeHoldout(testCase.id)) {
    holdoutExcluded += 1;
    continue;
  }

  const treeBuildResult = buildTreeFromHtml(
    testCase.data,
    {
      maxNodes: 4000,
      maxDepth: 256,
      maxAttributesPerElement: 256,
      maxAttributeBytes: 65536
    },
    {
      fragmentContextTagName: testCase.fragmentContext?.localName,
      scriptingEnabled: testCase.scriptingEnabled
    }
  );

  const actualTree = normalizeFixtureOutput(normalizeTree(treeBuildResult.document));
  const expectedTree = normalizeFixtureOutput(testCase.expected);

  if (actualTree === expectedTree) {
    passed += 1;
    continue;
  }

  failed += 1;

  if (divergenceCreated < DIVERGENCE_LIMIT) {
    await writeDivergenceRecord(testCase.id, testCase.data, expectedTree, actualTree);
    divergenceCreated += 1;
  }

  failures.push({
    id: testCase.id,
    fragmentContextTagName: testCase.fragmentContext?.localName ?? null,
    scriptingEnabled: testCase.scriptingEnabled,
    treeErrors: treeBuildResult.errors.slice(0, 10)
  });
}

const report = {
  suite: "tree",
  timestamp: new Date().toISOString(),
  cases: {
    total: allTests.length - holdoutExcluded,
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

await writeJson("reports/tree.json", report);

if (failed > 0) {
  console.error(`Tree fixture hard failures: ${failed}`);
  process.exit(1);
}

console.log(`Tree fixtures passed=${passed}, failed=${failed}, holdoutExcluded=${holdoutExcluded}`);
