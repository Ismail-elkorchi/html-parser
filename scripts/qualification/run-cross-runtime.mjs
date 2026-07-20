import { spawnSync } from "node:child_process";

import { readJson, writeJson } from "../lib/report.mjs";

const CONTROL = "scripts/smoke/control.mjs";
const runtimes = Object.freeze([
  Object.freeze({
    id: "node",
    command: process.execPath,
    args: [CONTROL, "--runtime=node", "--report=reports/smoke-node.json"]
  }),
  Object.freeze({
    id: "deno",
    command: "deno",
    args: [
      "run",
      "--allow-read",
      "--allow-write=reports",
      "--allow-env",
      CONTROL,
      "--runtime=deno",
      "--report=reports/smoke-deno.json"
    ]
  }),
  Object.freeze({
    id: "bun",
    command: "bun",
    args: ["run", CONTROL, "--runtime=bun", "--report=reports/smoke-bun.json"]
  })
]);

const results = [];
for (const runtime of runtimes) {
  const execution = spawnSync(runtime.command, runtime.args, { encoding: "utf8" });
  const reportPath = `reports/smoke-${runtime.id}.json`;
  if (execution.status !== 0) {
    results.push({
      id: runtime.id,
      status: "fail",
      exitCode: execution.status,
      error: execution.error?.message ?? (execution.stderr.trim() || execution.stdout.trim())
    });
    continue;
  }
  const smoke = await readJson(reportPath);
  results.push({
    id: runtime.id,
    status: smoke.ok === true ? "pass" : "fail",
    version: smoke.version,
    determinismHash: smoke.determinismHash,
    report: reportPath
  });
}

const hashes = new Set(results.map((result) => result.determinismHash).filter(Boolean));
const exactAgreement = results.length === runtimes.length &&
  results.every((result) => result.status === "pass") && hashes.size === 1;
const report = {
  schemaVersion: 1,
  suite: "html-parser-cross-runtime",
  generatedAt: new Date().toISOString(),
  expectedRuntimes: runtimes.map((runtime) => runtime.id),
  results,
  exactAgreement
};
await writeJson("reports/cross-runtime.json", report);
console.log(JSON.stringify(report, null, 2));
if (!exactAgreement) process.exitCode = 1;
