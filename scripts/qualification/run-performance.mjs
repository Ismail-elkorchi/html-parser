import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { writeJson } from "../eval/eval-primitives.mjs";

const RUNS = Number(process.env["ENGINE_PERFORMANCE_RUNS"] ?? 12);
if (!Number.isSafeInteger(RUNS) || RUNS < 3) {
  throw new Error("ENGINE_PERFORMANCE_RUNS must be a safe integer of at least 3");
}

const ROOT = process.cwd();
const DRIVER = path.join(ROOT, "scripts/qualification/benchmark-engine.mjs");
const WORKTREE_ROOT = path.join(ROOT, "tmp/qualification-performance");
const BENCHMARK_RUNTIME_FLAGS = Object.freeze([
  "--expose-gc",
  "--max-old-space-size=256",
  "--max-semi-space-size=8"
]);
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
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
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
      retainedHeapDeltaBytes: stats(
        entries.map((entry) => entry?.retainedHeapDeltaBytes ?? 0)
      ),
      retainedHeapBytesPerResult: stats(
        entries.map((entry) => entry?.retainedHeapBytesPerResult ?? 0)
      )
    }];
  }));
}

function measure(moduleRoot, engine) {
  const output = run(process.execPath, [
    ...BENCHMARK_RUNTIME_FLAGS,
    DRIVER,
    `--module-root=${moduleRoot}`,
    `--engine=${engine}`
  ]);
  return JSON.parse(output);
}

await mkdir(WORKTREE_ROOT, { recursive: true });
const revisions = {};
const worktrees = [];
try {
  const measurementTargets = [];
  for (const reference of REFERENCES) {
    const worktree = path.join(WORKTREE_ROOT, reference.id.replaceAll(".", "-"));
    run("git", ["worktree", "add", "--detach", worktree, reference.ref]);
    worktrees.push(worktree);
    run("npm", ["ci"], { cwd: worktree });
    const commit = run("git", ["rev-parse", "HEAD"], { cwd: worktree }).trim();
    measurementTargets.push({
      id: reference.id,
      moduleRoot: worktree,
      engine: reference.engine,
      commit,
      results: []
    });
  }

  measurementTargets.push({
    id: "candidate",
    moduleRoot: ROOT,
    engine: "public",
    commit: run("git", ["rev-parse", "HEAD"]).trim(),
    results: []
  });

  // Rotate the deterministic order on every round. Sampling each revision in a
  // separate time block made ratios sensitive to host load and CPU-frequency
  // drift, while still claiming to compare like-for-like measurements.
  for (let runIndex = 0; runIndex < RUNS; runIndex += 1) {
    const offset = runIndex % measurementTargets.length;
    const orderedTargets = [
      ...measurementTargets.slice(offset),
      ...measurementTargets.slice(0, offset)
    ];
    for (const target of orderedTargets) {
      target.results.push(measure(target.moduleRoot, target.engine));
    }
  }

  for (const target of measurementTargets) {
    revisions[target.id] = {
      commit: target.commit,
      engine: target.engine,
      runs: target.results,
      benchmarks: summarize(target.results)
    };
  }
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
      current.retainedHeapBytesPerResult.median / baseline.retainedHeapBytesPerResult.median,
    baselineThroughputRobustSpreadFraction:
      baseline.throughputMbPerSec.robustSpreadFraction,
    baselineMemoryRobustSpreadFraction:
      baseline.retainedHeapBytesPerResult.robustSpreadFraction,
    throughputRobustSpreadFraction: current.throughputMbPerSec.robustSpreadFraction,
    memoryRobustSpreadFraction: current.retainedHeapBytesPerResult.robustSpreadFraction
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
    comparison.baselineThroughputRobustSpreadFraction >
    THRESHOLDS.maxThroughputRobustSpreadFraction
  ) {
    failures.push(`${name}:baseline-throughput-spread`);
  }
  if (
    comparison.baselineMemoryRobustSpreadFraction >
    THRESHOLDS.maxMemoryRobustSpreadFraction
  ) {
    failures.push(`${name}:baseline-memory-spread`);
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
  schemaVersion: 2,
  suite: "independent-engine-cross-revision-performance",
  generatedAt: new Date().toISOString(),
  runs: RUNS,
  runIsolation: "fresh-process-per-sample",
  samplingOrder: "deterministic-balanced-revision-interleaving",
  percentileMethod: "linear interpolation between closest ranks",
  memoryMetric:
    "post-GC retained parsed-result heap slope from a post-warmup fixed-size cohort",
  runtimeHeapConfiguration: Object.freeze({
    maxOldSpaceSizeMb: 256,
    maxSemiSpaceSizeMb: 8
  }),
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
