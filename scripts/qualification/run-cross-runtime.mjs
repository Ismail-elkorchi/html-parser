import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { writeJson } from "../eval/eval-primitives.mjs";

const SCRIPT = "scripts/qualification/runtime-smoke.mjs";
const runtimes = Object.freeze([
  Object.freeze({ id: "node", command: process.execPath, args: [SCRIPT], versionArgs: ["--version"] }),
  Object.freeze({ id: "deno", command: "deno", args: ["run", "--allow-read", SCRIPT], versionArgs: ["--version"] }),
  Object.freeze({ id: "bun", command: "bun", args: ["run", SCRIPT], versionArgs: ["--version"] })
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const results = [];
for (const runtime of runtimes) {
  try {
    const output = execFileSync(runtime.command, runtime.args, { encoding: "utf8" }).trim();
    JSON.parse(output);
    results.push({
      id: runtime.id,
      available: true,
      version: execFileSync(runtime.command, runtime.versionArgs, { encoding: "utf8" }).trim(),
      outputSha256: sha256(output)
    });
  } catch (error) {
    results.push({
      id: runtime.id,
      available: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

const available = results.filter((result) => result.available);
const outputHashes = new Set(available.map((result) => result.outputSha256));
const report = {
  schemaVersion: 1,
  suite: "independent-engine-cross-runtime",
  generatedAt: new Date().toISOString(),
  expectedRuntimes: runtimes.map((runtime) => runtime.id),
  results,
  exactAgreement: available.length === runtimes.length && outputHashes.size === 1
};
await writeJson("reports/engine-cross-runtime.json", report);
console.log(JSON.stringify(report, null, 2));
if (!report.exactAgreement) process.exitCode = 1;
