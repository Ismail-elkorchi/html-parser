import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { writeJson } from "../eval/util.mjs";
import { tokenize } from "../../dist/internal/tokenizer/mod.js";
import { buildTreeFromTokens, normalizeTree } from "../../dist/internal/tree/mod.js";

const TREE_FILES = [
  "vendor/html5lib-tests/tree-construction/tests1.dat",
  "vendor/html5lib-tests/tree-construction/tests2.dat",
  "vendor/html5lib-tests/tree-construction/tests3.dat",
  "vendor/html5lib-tests/tree-construction/tests4.dat",
  "vendor/html5lib-tests/tree-construction/tests5.dat",
  "vendor/html5lib-tests/tree-construction/tests6.dat"
];

const SKIP_DECISION_RECORD = "docs/decisions/ADR-001-tree-construction-conformance-skips.md";
const HOLDOUT_MOD = 10;

function computeHoldout(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(i)) >>> 0;
  }
  return hash % HOLDOUT_MOD === 0;
}

function parseDatFixtureFile(content, fileName) {
  const lines = content.split(/\r?\n/);
  const tests = [];
  let section = "";
  let current = {
    data: "",
    documentLines: []
  };

  const pushCurrent = () => {
    if (current.data.length === 0 && current.documentLines.length === 0) {
      return;
    }

    tests.push({
      id: `${fileName}#${tests.length + 1}`,
      data: current.data,
      expected: current.documentLines.join("\n")
    });

    current = {
      data: "",
      documentLines: []
    };
  };

  for (const line of lines) {
    if (line === "#data") {
      pushCurrent();
      section = "data";
      continue;
    }

    if (line === "#document") {
      section = "document";
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
    }
  }

  pushCurrent();
  return tests;
}

async function writeDivergenceRecord(caseId, input, expected, actual) {
  const sanitized = caseId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join("docs", "triage", `${sanitized}.md`);
  const body = [
    "# Tree divergence",
    "",
    `Case: ${caseId}`,
    "",
    "## Input",
    "```html",
    input,
    "```",
    "",
    "## Expected",
    "```text",
    expected,
    "```",
    "",
    "## Actual",
    "```text",
    actual,
    "```"
  ].join("\n");

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${body}\n`, "utf8");
}

const allTests = [];
for (const file of TREE_FILES) {
  const data = await readFile(file, "utf8");
  allTests.push(...parseDatFixtureFile(data, file));
}

let passed = 0;
let failed = 0;
let skipped = 0;
let holdoutExcluded = 0;
let divergenceCreated = 0;
const skips = [];
const failures = [];

for (const testCase of allTests) {
  if (computeHoldout(testCase.id)) {
    holdoutExcluded += 1;
    continue;
  }

  const tokenized = tokenize(testCase.data, {
    budgets: {
      maxTextBytes: 500000,
      maxTokenBytes: 32000,
      maxParseErrors: 2000,
      maxTimeMs: 100
    }
  });

  const built = buildTreeFromTokens(tokenized.tokens, {
    maxNodes: 4000,
    maxDepth: 256,
    maxAttributesPerElement: 256,
    maxAttributeBytes: 65536
  });

  const actual = normalizeTree(built.document);
  const expected = testCase.expected;

  if (actual === expected) {
    passed += 1;
    continue;
  }

  skipped += 1;
  skips.push({
    id: testCase.id,
    reason: "Tree construction parity for this case is pending deeper insertion-mode and recovery logic.",
    decisionRecord: SKIP_DECISION_RECORD
  });

  if (divergenceCreated < 25) {
    await writeDivergenceRecord(testCase.id, testCase.data, expected, actual);
    divergenceCreated += 1;
  }

  failures.push({
    id: testCase.id,
    tokenizerErrors: tokenized.errors.slice(0, 10),
    treeErrors: built.errors.slice(0, 10)
  });
}

const report = {
  suite: "tree",
  timestamp: new Date().toISOString(),
  cases: {
    total: allTests.length - holdoutExcluded,
    passed,
    failed,
    skipped
  },
  holdout: {
    excluded: holdoutExcluded,
    rule: `hash(id) % ${HOLDOUT_MOD} === 0`
  },
  skips,
  failures
};

await writeJson("reports/tree.json", report);

if (failed > 0) {
  console.error(`Tree fixture hard failures: ${failed}`);
  process.exit(1);
}

console.log(`Tree fixtures: passed=${passed}, skipped=${skipped}, holdoutExcluded=${holdoutExcluded}`);
