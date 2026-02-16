import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

import { nowIso, readJson, writeJson } from "../eval/eval-primitives.mjs";

function actRunNodeScript(scriptPath) {
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

async function evalReportHasFailures(reportPath) {
  await stat(reportPath);
  const report = await readJson(reportPath);
  const failed = Number(report?.cases?.failed || 0);

  return failed > 0;
}

const conformanceSuites = [
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
  const suiteResults = [];
  let hasSuiteFailures = false;

  // ADR-006 and ADR-007 enforce mismatch-as-failure for tokenizer and tree conformance.
  for (const conformanceSuite of conformanceSuites) {
    const startedAt = Date.now();
    try {
      await actRunNodeScript(conformanceSuite.script);
      const reportHasFailures = await evalReportHasFailures(conformanceSuite.report);
      if (reportHasFailures) {
        hasSuiteFailures = true;
      }
      suiteResults.push({
        id: conformanceSuite.id,
        ok: !reportHasFailures,
        report: conformanceSuite.report,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      hasSuiteFailures = true;
      suiteResults.push({
        id: conformanceSuite.id,
        ok: false,
        report: conformanceSuite.report,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  await writeJson("reports/conformance-summary.json", {
    suite: "conformance-summary",
    timestamp: nowIso(),
    ok: !hasSuiteFailures,
    suites: suiteResults
  });

  if (hasSuiteFailures) {
    console.error("Conformance run failed. See reports/conformance-summary.json");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
