import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { writeJson } from "../eval/eval-primitives.mjs";

const DEFAULT_RUNS = 9;
const DEFAULT_WARMUPS_PER_RUN = 1;
const BENCH_REPORT_PATH = resolve(process.cwd(), "reports/bench.json");

function parseRunsArg() {
  const runArg = process.argv.find((argumentValue) => argumentValue.startsWith("--runs="));
  const parsed = Number(runArg?.split("=")[1] || DEFAULT_RUNS);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --runs value: ${String(runArg)}`);
  }
  return parsed;
}

function parseWarmupsArg() {
  const warmupArg = process.argv.find((argumentValue) => argumentValue.startsWith("--warmups="));
  const parsed = Number(warmupArg?.split("=")[1] || DEFAULT_WARMUPS_PER_RUN);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid --warmups value: ${String(warmupArg)}`);
  }
  return parsed;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return 0;
  }
  const boundedFraction = Math.max(0, Math.min(1, fraction));
  const index = Math.floor((sorted.length - 1) * boundedFraction);
  return sorted[index] ?? 0;
}

function stats(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return {
      values: [],
      min: 0,
      max: 0,
      median: 0,
      p10: 0,
      p90: 0,
      spreadFraction: 0,
      robustSpreadFraction: 0
    };
  }

  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p10 = percentile(sorted, 0.1);
  const p90 = percentile(sorted, 0.9);

  return {
    values,
    min,
    max,
    median,
    p10,
    p90,
    spreadFraction: median === 0 ? 0 : (max - min) / median,
    robustSpreadFraction: median === 0 ? 0 : (p90 - p10) / median
  };
}

function summarizeRuns(runResults) {
  const benchmarkNames = [...new Set(runResults.flatMap((runResult) => runResult.map((entry) => entry.name)))];
  const benchmarks = {};

  for (const benchmarkName of benchmarkNames) {
    const mbPerSecValues = runResults.map((runResult) =>
      Number(runResult.find((entry) => entry.name === benchmarkName)?.mbPerSec || 0)
    );
    const memoryValues = runResults.map((runResult) =>
      Number(runResult.find((entry) => entry.name === benchmarkName)?.memoryMB || 0)
    );

    benchmarks[benchmarkName] = {
      mbPerSec: stats(mbPerSecValues),
      memoryMB: stats(memoryValues)
    };
  }

  return benchmarks;
}

function runBenchOnce() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--expose-gc", "scripts/bench/run-bench.mjs"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      rejectPromise(error);
    });

    child.on("close", async (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`bench run failed: code=${String(code)} stderr=${stderr.trim()}`));
        return;
      }

      try {
        const source = await readFile(BENCH_REPORT_PATH, "utf8");
        const parsed = JSON.parse(source);
        const benchmarks = Array.isArray(parsed.benchmarks) ? parsed.benchmarks : null;
        if (!benchmarks) {
          rejectPromise(new Error("bench report missing benchmarks array"));
          return;
        }
        resolvePromise(benchmarks);
      } catch (error) {
        rejectPromise(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

const runs = parseRunsArg();
const warmupsPerRun = parseWarmupsArg();
const runResults = [];

for (let runIndex = 0; runIndex < runs; runIndex += 1) {
  for (let warmupIndex = 0; warmupIndex < warmupsPerRun; warmupIndex += 1) {
    await runBenchOnce();
  }
  const measured = await runBenchOnce();
  runResults.push(measured);
}

const benchmarks = summarizeRuns(runResults);
await writeJson("reports/bench-stability.json", {
  suite: "bench-stability",
  timestamp: new Date().toISOString(),
  runs,
  warmupsPerRun,
  runIsolation: "subprocess-per-run",
  benchmarks
});

console.log(
  `Bench stability complete: runs=${String(runs)} warmups=${String(warmupsPerRun)} benchmarks=${String(Object.keys(benchmarks).length)}`
);
