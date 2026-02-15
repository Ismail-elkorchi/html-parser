import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

import { readJson, writeJson, nowIso } from "../eval/util.mjs";

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${scriptPath} failed with exit code ${String(code)}`));
    });
  });
}

async function hasFailures(reportPath) {
  await stat(reportPath);
  const report = await readJson(reportPath);
  const failed = Number(report?.cases?.failed || 0);

  return failed > 0;
}

const suites = [
  {
    id: "tokenizer",
    script: "scripts/conformance/run-tokenizer-fixtures.mjs",
    report: "reports/tokenizer.json"
  },
  {
    id: "tree",
    script: "scripts/conformance/run-tree-fixtures.mjs",
    report: "reports/tree.json"
  },
  {
    id: "encoding",
    script: "scripts/conformance/run-encoding-fixtures.mjs",
    report: "reports/encoding.json"
  },
  {
    id: "serializer",
    script: "scripts/conformance/run-serializer-fixtures.mjs",
    report: "reports/serializer.json"
  },
  {
    id: "holdout",
    script: "scripts/conformance/run-holdout-fixtures.mjs",
    report: "reports/holdout.json"
  }
];

async function main() {
  const results = [];
  let failed = false;

  // ADR-006 and ADR-007 enforce mismatch-as-failure for tokenizer and tree conformance.
  for (const suite of suites) {
    const startedAt = Date.now();
    try {
      await runNodeScript(suite.script);
      const reportHasFailures = await hasFailures(suite.report);
      if (reportHasFailures) {
        failed = true;
      }
      results.push({
        id: suite.id,
        ok: !reportHasFailures,
        report: suite.report,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      failed = true;
      results.push({
        id: suite.id,
        ok: false,
        report: suite.report,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  await writeJson("reports/conformance-summary.json", {
    suite: "conformance-summary",
    timestamp: nowIso(),
    ok: !failed,
    suites: results
  });

  if (failed) {
    console.error("Conformance run failed. See reports/conformance-summary.json");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
