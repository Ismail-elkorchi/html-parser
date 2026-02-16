import { spawn } from "node:child_process";

import { fileExists, nowIso, readJson, writeJson } from "./util.mjs";

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${String(code)}`));
    });
  });
}

async function runStep(stepId, command, args) {
  const startedAt = Date.now();
  try {
    await runCommand(command, args);
    return {
      id: stepId,
      ok: true,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      id: stepId,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function parseProfileArg() {
  const arg = process.argv.find((value) => value.startsWith("--profile="));
  const profile = arg ? arg.split("=")[1] : "ci";
  if (profile !== "ci" && profile !== "release") {
    throw new Error(`Unsupported profile: ${profile}`);
  }
  return profile;
}

async function main() {
  const profile = parseProfileArg();

  const steps = [
    ["tests", "npm", ["run", "test"]],
    ["conformance", process.execPath, ["scripts/conformance/run-all.mjs"]],
    ["determinism-budgets", process.execPath, ["scripts/eval/write-stub-reports.mjs"]],
    ["smoke-node", "npm", ["run", "smoke:node"]],
    ["smoke-deno", "npm", ["run", "smoke:deno"]],
    ["smoke-bun", "npm", ["run", "smoke:bun"]],
    ["docs", process.execPath, ["scripts/eval/check-docs.mjs"]],
    ["no-external-imports", process.execPath, ["scripts/eval/check-no-external-imports.mjs"]],
    ["no-node-builtins", process.execPath, ["scripts/eval/check-no-node-builtins.mjs"]],
    ["runtime-self-contained", process.execPath, ["scripts/eval/check-runtime-self-contained.mjs"]],
    ["packaging", process.execPath, ["scripts/eval/pack-check.mjs"]]
  ];

  if (profile === "release") {
    steps.push(["browser-diff", "npm", ["run", "test:browser-diff"]]);
    steps.push(["fuzz", "npm", ["run", "test:fuzz"]]);
    steps.push(["bench", "npm", ["run", "test:bench"]]);
  }

  steps.push(["gates", process.execPath, ["scripts/eval/check-gates.mjs", `--profile=${profile}`]]);
  steps.push(["score", process.execPath, ["scripts/eval/score.mjs", `--profile=${profile}`]]);
  steps.push(["report", process.execPath, ["scripts/eval/report.mjs", `--profile=${profile}`]]);

  const stepResults = [];
  for (const [stepId, command, args] of steps) {
    const result = await runStep(stepId, command, args);
    stepResults.push(result);
  }

  const gatesReport = (await fileExists("reports/gates.json")) ? await readJson("reports/gates.json") : null;
  const scoreReport = (await fileExists("reports/score.json")) ? await readJson("reports/score.json") : null;
  const gatesPass = Boolean(gatesReport?.allPass);
  const stepsPass = stepResults.every((stepResult) => stepResult.ok);
  const ok = stepsPass && gatesPass;

  await writeJson("reports/eval-summary.json", {
    suite: "eval-summary",
    timestamp: nowIso(),
    profile,
    ok,
    stepsPass,
    gatesPass,
    score: Number(scoreReport?.total || 0),
    steps: stepResults
  });

  if (!ok) {
    console.error("EVAL: Evaluation failed. See reports/eval-summary.json");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
