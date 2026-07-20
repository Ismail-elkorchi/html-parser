import { spawnSync } from "node:child_process";

import { parseLongOptions } from "../lib/cli.mjs";
import { writeJson } from "../lib/report.mjs";

const { profile } = parseLongOptions(process.argv.slice(2), {
  profile: { type: "string", required: true }
}, "qualification profile");
if (profile !== "ci" && profile !== "release") {
  throw new Error(`qualification profile: unsupported profile ${profile}`);
}

const ciSteps = Object.freeze([
  Object.freeze({ id: "checks", command: "check:fast" }),
  Object.freeze({ id: "conformance", command: "test:conformance" }),
  Object.freeze({ id: "cross-runtime", command: "qualification:runtime" }),
  Object.freeze({ id: "browser-smoke", command: "smoke:browser" }),
  Object.freeze({ id: "package", command: "qualification:package" })
]);
const releaseSteps = Object.freeze([
  Object.freeze({ id: "serialization", command: "qualification:serialization" }),
  Object.freeze({ id: "fragments", command: "qualification:fragments" }),
  Object.freeze({ id: "document-browser", command: "oracle:documents" }),
  Object.freeze({ id: "serialization-browser", command: "oracle:serialization" }),
  Object.freeze({ id: "fragment-browser", command: "oracle:fragments" }),
  Object.freeze({ id: "fuzz", command: "qualification:fuzz" }),
  Object.freeze({ id: "resources", command: "qualification:resources" }),
  Object.freeze({ id: "mutation", command: "qualification:mutation" }),
  Object.freeze({ id: "supply-chain", command: "qualification:supply-chain" }),
  Object.freeze({ id: "performance", command: "qualification:performance" })
]);
const steps = profile === "release" ? [...ciSteps, ...releaseSteps] : [...ciSteps];

const clean = spawnSync(process.execPath, ["scripts/qualification/clean-reports.mjs"], {
  stdio: "inherit"
});
if (clean.status !== 0) throw clean.error ?? new Error("could not clean qualification reports");

const results = [];
for (const step of steps) {
  const startedAt = Date.now();
  const execution = spawnSync("npm", ["run", step.command], { stdio: "inherit" });
  const result = {
    id: step.id,
    command: `npm run ${step.command}`,
    durationMs: Date.now() - startedAt,
    ok: execution.status === 0,
    exitCode: execution.status
  };
  results.push(result);
  if (!result.ok) break;
}

const ok = results.length === steps.length && results.every((result) => result.ok);
const report = {
  schemaVersion: 1,
  suite: "html-parser-qualification",
  generatedAt: new Date().toISOString(),
  profile,
  ok,
  steps: results
};
await writeJson(`reports/qualification-${profile}.json`, report);
if (!ok) {
  console.error(`Qualification ${profile} failed at ${results.at(-1)?.id ?? "startup"}`);
  process.exitCode = 1;
}
