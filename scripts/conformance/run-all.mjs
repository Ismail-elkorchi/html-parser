import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

import { nowIso, readJson, writeJson } from "../lib/report.mjs";

function runNodeScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
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

async function reportHasFailures(reportPath) {
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
    script: "scripts/conformance/run-wpt-tree.mjs",
    report: "reports/wpt-tree.json"
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
  }
];

async function main() {
  const suiteResults = [];
  let hasSuiteFailures = false;

  // Every reported conformance mismatch fails the aggregate run.
  for (const conformanceSuite of conformanceSuites) {
    const startedAt = Date.now();
    try {
      await runNodeScript(conformanceSuite.script, conformanceSuite.args);
      const hasFailures = await reportHasFailures(conformanceSuite.report);
      if (hasFailures) {
        hasSuiteFailures = true;
      }
      suiteResults.push({
        id: conformanceSuite.id,
        ok: !hasFailures,
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
    schemaVersion: 2,
    suite: "html-parser-conformance",
    generatedAt: nowIso(),
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
