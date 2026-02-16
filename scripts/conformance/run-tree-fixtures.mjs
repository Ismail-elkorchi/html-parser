import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { writeJson } from "../eval/eval-primitives.mjs";
import { buildTreeFromHtml, normalizeTree } from "../../dist/internal/tree/mod.js";

const TREE_FILES = [
  "vendor/html5lib-tests/tree-construction/tests1.dat",
  "vendor/html5lib-tests/tree-construction/tests2.dat",
  "vendor/html5lib-tests/tree-construction/tests3.dat",
  "vendor/html5lib-tests/tree-construction/tests4.dat",
  "vendor/html5lib-tests/tree-construction/tests5.dat",
  "vendor/html5lib-tests/tree-construction/tests6.dat"
];

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

function parseDatFixtureFile(content, fixtureFilePath) {
  const lines = content.split(/\r?\n/);
  const parsedFixtureCases = [];
  let section = "";
  let current = null;

  const pushCurrent = () => {
    if (current === null) {
      return;
    }

    if (current.data.length === 0 && current.documentLines.length === 0) {
      current = null;
      section = "";
      return;
    }

    parsedFixtureCases.push({
      id: `${fixtureFilePath}#${parsedFixtureCases.length + 1}`,
      data: current.data,
      expected: current.documentLines.join("\n"),
      fragmentContextTagName: current.fragmentContextTagName,
      scriptingEnabled: current.scriptingEnabled
    });

    current = null;
    section = "";
  };

  for (const line of lines) {
    if (line === "#data") {
      pushCurrent();
      current = {
        data: "",
        documentLines: [],
        fragmentContextTagName: undefined,
        scriptingEnabled: true
      };
      section = "data";
      continue;
    }

    if (current === null) {
      continue;
    }

    if (line === "#errors" || line === "#new-errors") {
      section = "errors";
      continue;
    }

    if (line === "#document") {
      section = "document";
      continue;
    }

    if (line === "#document-fragment") {
      section = "fragment";
      continue;
    }

    if (line === "#script-on") {
      current.scriptingEnabled = true;
      section = "";
      continue;
    }

    if (line === "#script-off") {
      current.scriptingEnabled = false;
      section = "";
      continue;
    }

    if (line.startsWith("#")) {
      section = "";
      continue;
    }

    if (section === "data") {
      if (current.data.length > 0) {
        current.data += "\n";
      }
      current.data += line;
      continue;
    }

    if (section === "document") {
      current.documentLines.push(line);
      continue;
    }

    if (section === "fragment") {
      if (current.fragmentContextTagName === undefined) {
        current.fragmentContextTagName = line.trim().toLowerCase();
      }
    }
  }

  pushCurrent();
  return parsedFixtureCases;
}

function normalizeFixtureOutput(value) {
  return value.trimEnd();
}

async function writeDivergenceRecord(caseId, inputHtml, expectedTree, actualTree) {
  const sanitized = caseId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join("docs", "triage", `${sanitized}.md`);
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
for (const fixturePath of TREE_FILES) {
  const fixtureData = await readFile(fixturePath, "utf8");
  allTests.push(...parseDatFixtureFile(fixtureData, fixturePath));
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
      fragmentContextTagName: testCase.fragmentContextTagName,
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
    fragmentContextTagName: testCase.fragmentContextTagName ?? null,
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
  console.error(`EVAL: Tree fixture hard failures: ${failed}`);
  process.exit(1);
}

console.log(`ACT: Tree fixtures passed=${passed}, failed=${failed}, holdoutExcluded=${holdoutExcluded}`);
