import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { writeJson } from "../eval/eval-primitives.mjs";

const RUNS = Number(process.env["ENGINE_PERFORMANCE_RUNS"] ?? 9);
if (!Number.isSafeInteger(RUNS) || RUNS < 3) {
  throw new Error("ENGINE_PERFORMANCE_RUNS must be a safe integer of at least 3");
}

const ROOT = process.cwd();
const DRIVER = path.join(ROOT, "scripts/qualification/benchmark-engine.mjs");
const WORKTREE_ROOT = path.join(ROOT, "tmp/qualification-performance");
const REFERENCES = Object.freeze([
  Object.freeze({ id: "v0.1.1", ref: "v0.1.1", engine: "public" }),
  Object.freeze({ id: "d74d661", ref: "d74d661a7a64ac6a87ee7fc558aaabc77cce0916", engine: "public" })
]);
const THRESHOLDS = Object.freeze({
  minThroughputMedianRatio: 0.9,
  maxMemoryMedianRatio: 1.1,
  maxThroughputRobustSpreadFraction: 0.2,
  maxMemoryRobustSpreadFraction: 0.15
});

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: process.env
  });
}

function percentile(sorted, fraction) {
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}

function stats(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
  const p10 = percentile(sorted, 0.1);
  const p90 = percentile(sorted, 0.9);
  return {
    values,
    median,
    p10,
    p90,
    robustSpreadFraction: median === 0 ? 0 : (p90 - p10) / median
  };
}

function summarize(runResults) {
  const names = [...new Set(runResults.flatMap((runResult) =>
    runResult.results.map((entry) => entry.name)
  ))];
  return Object.fromEntries(names.map((name) => {
    const entries = runResults.map((runResult) =>
      runResult.results.find((entry) => entry.name === name)
    );
    return [name, {
      throughputMbPerSec: stats(entries.map((entry) => entry?.throughputMbPerSec ?? 0)),
      cpuMs: stats(entries.map((entry) => entry?.cpuMs ?? 0)),
      retainedHeapBytes: stats(entries.map((entry) => entry?.retainedHeapBytes ?? 0)),
      retainedHeapDeltaBytes: stats(entries.map((entry) => entry?.retainedHeapDeltaBytes ?? 0)),
      peakHeapBytes: stats(entries.map((entry) => entry?.peakHeapBytes ?? 0)),
      peakHeapDeltaBytes: stats(entries.map((entry) => entry?.peakHeapDeltaBytes ?? 0))
    }];
  }));
}

function measure(moduleRoot, engine) {
  const results = [];
  for (let runIndex = 0; runIndex < RUNS; runIndex += 1) {
    const output = run(process.execPath, [
      "--expose-gc",
      DRIVER,
      `--module-root=${moduleRoot}`,
      `--engine=${engine}`
    ]);
    results.push(JSON.parse(output));
  }
  return { runs: results, benchmarks: summarize(results) };
}

await mkdir(WORKTREE_ROOT, { recursive: true });
const revisions = {};
const worktrees = [];
try {
  for (const reference of REFERENCES) {
    const worktree = path.join(WORKTREE_ROOT, reference.id.replaceAll(".", "-"));
    run("git", ["worktree", "add", "--detach", worktree, reference.ref]);
    worktrees.push(worktree);
    run("npm", ["ci"], { cwd: worktree });
    const commit = run("git", ["rev-parse", "HEAD"], { cwd: worktree }).trim();
    revisions[reference.id] = {
      commit,
      engine: reference.engine,
      ...measure(worktree, reference.engine)
    };
  }

  revisions.candidate = {
    commit: run("git", ["rev-parse", "HEAD"]).trim(),
    engine: "candidate",
    ...measure(ROOT, "candidate")
  };
} finally {
  for (const worktree of worktrees.reverse()) {
    try {
      run("git", ["worktree", "remove", "--force", worktree]);
    } catch {
      // Keep the primary qualification failure; stale temporary worktrees are recoverable.
    }
  }
  await rm(WORKTREE_ROOT, { recursive: true, force: true });
}

const primary = revisions.d74d661.benchmarks;
const candidate = revisions.candidate.benchmarks;
const comparisons = Object.fromEntries(Object.keys(candidate).map((name) => {
  const baseline = primary[name];
  const current = candidate[name];
  return [name, {
    throughputMedianRatio:
      current.throughputMbPerSec.median / baseline.throughputMbPerSec.median,
    memoryMedianRatio:
      current.peakHeapDeltaBytes.median / baseline.peakHeapDeltaBytes.median,
    throughputRobustSpreadFraction: current.throughputMbPerSec.robustSpreadFraction,
    memoryRobustSpreadFraction: current.peakHeapDeltaBytes.robustSpreadFraction
  }];
}));
const failures = [];
for (const [name, comparison] of Object.entries(comparisons)) {
  if (comparison.throughputMedianRatio < THRESHOLDS.minThroughputMedianRatio) {
    failures.push(`${name}:throughput-ratio`);
  }
  if (comparison.memoryMedianRatio > THRESHOLDS.maxMemoryMedianRatio) {
    failures.push(`${name}:memory-ratio`);
  }
  if (
    comparison.throughputRobustSpreadFraction >
    THRESHOLDS.maxThroughputRobustSpreadFraction
  ) {
    failures.push(`${name}:throughput-spread`);
  }
  if (comparison.memoryRobustSpreadFraction > THRESHOLDS.maxMemoryRobustSpreadFraction) {
    failures.push(`${name}:memory-spread`);
  }
}

const report = {
  schemaVersion: 1,
  suite: "independent-engine-cross-revision-performance",
  generatedAt: new Date().toISOString(),
  runs: RUNS,
  runIsolation: "fresh-process-per-sample",
  memoryMetric: "peak heap delta after steady-state warmup",
  primaryBaseline: "d74d661",
  historicalBaseline: "v0.1.1",
  thresholds: THRESHOLDS,
  revisions,
  comparisons,
  failures,
  ok: failures.length === 0
};
await writeJson("reports/engine-performance.json", report);
console.log(JSON.stringify({ comparisons, failures, ok: report.ok }, null, 2));
if (!report.ok) process.exitCode = 1;
