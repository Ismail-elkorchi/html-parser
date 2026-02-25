import { readFile } from "node:fs/promises";

import { nowIso, writeJson } from "./eval-primitives.mjs";

const RUNTIME_REPORTS = [
  { name: "node", path: "reports/smoke-node.json", required: true },
  { name: "deno", path: "reports/smoke-deno.json", required: true },
  { name: "bun", path: "reports/smoke-bun.json", required: true },
  { name: "browser", path: "reports/smoke-browser.json", required: true }
];

async function readRuntimeReport(path) {
  try {
    const rawText = await readFile(path, "utf8");
    return JSON.parse(rawText);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function main() {
  const runtimes = {};
  for (const runtimeReport of RUNTIME_REPORTS) {
    const report = await readRuntimeReport(runtimeReport.path);
    if (report === null) {
      runtimes[runtimeReport.name] = {
        suite: "smoke-runtime",
        runtime: runtimeReport.name,
        ok: runtimeReport.required ? false : true,
        required: runtimeReport.required,
        missing: true
      };
      continue;
    }
    runtimes[runtimeReport.name] = report;
  }

  const overallOk = RUNTIME_REPORTS
    .filter((runtimeReport) => runtimeReport.required)
    .every((runtimeReport) => runtimes[runtimeReport.name]?.ok === true);

  await writeJson("reports/smoke.json", {
    suite: "smoke",
    timestamp: nowIso(),
    runtimes,
    overall: {
      ok: overallOk
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
