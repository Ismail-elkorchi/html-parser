import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { writeJson } from "../eval/eval-primitives.mjs";
import {
  evaluatePerformance,
  PERFORMANCE_BENCHMARK_NAMES,
  PERFORMANCE_BASELINES,
  PERFORMANCE_THRESHOLDS
} from "./performance-policy.mjs";

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
  PERFORMANCE_BASELINES.historical,
  PERFORMANCE_BASELINES.parser,
  PERFORMANCE_BASELINES.serializer
]);

const candidateStatus = run("git", ["status", "--porcelain", "--untracked-files=no"]).trim();
if (candidateStatus.length > 0) {
  throw new Error("Performance qualification requires a clean tracked candidate revision");
}
const historicalTagCommit = run("git", [
  "rev-parse",
  `${PERFORMANCE_BASELINES.historical.tag}^{commit}`
]).trim();
if (historicalTagCommit !== PERFORMANCE_BASELINES.historical.ref) {
  throw new Error(
    `${PERFORMANCE_BASELINES.historical.tag} resolves to ${historicalTagCommit}, expected ${PERFORMANCE_BASELINES.historical.ref}`
  );
}

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

function measure(moduleRoot, engine, benchmark) {
  const output = run(process.execPath, [
    ...BENCHMARK_RUNTIME_FLAGS,
    DRIVER,
    `--module-root=${moduleRoot}`,
    `--engine=${engine}`,
    `--benchmark=${benchmark}`
  ]);
  return JSON.parse(output);
}

await mkdir(WORKTREE_ROOT, { recursive: true });
const revisions = {};
const worktrees = [];
const sampleOrder = [];
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
      engine: "public",
      commit,
      benchmarks: reference.benchmarks,
      results: Array.from({ length: RUNS }, () => ({ results: [] }))
    });
  }

  measurementTargets.push({
    id: "candidate",
    moduleRoot: ROOT,
    engine: "public",
    commit: run("git", ["rev-parse", "HEAD"]).trim(),
    benchmarks: PERFORMANCE_BENCHMARK_NAMES,
    results: Array.from({ length: RUNS }, () => ({ results: [] }))
  });

  // Interleave revisions independently for every benchmark and rotate the
  // starting revision on every round. This prevents a faster benchmark or a
  // revision with fewer applicable benchmarks from receiving a systematic
  // host-load or CPU-frequency advantage.
  for (let runIndex = 0; runIndex < RUNS; runIndex += 1) {
    const benchmarkOrder = [];
    for (const [benchmarkIndex, benchmark] of PERFORMANCE_BENCHMARK_NAMES.entries()) {
      const applicableTargets = measurementTargets.filter((target) =>
        target.benchmarks.includes(benchmark)
      );
      const offset = (runIndex + benchmarkIndex) % applicableTargets.length;
      const orderedTargets = [
        ...applicableTargets.slice(offset),
        ...applicableTargets.slice(0, offset)
      ];
      benchmarkOrder.push({ benchmark, revisions: orderedTargets.map((target) => target.id) });
      for (const target of orderedTargets) {
        const measurement = measure(target.moduleRoot, target.engine, benchmark);
        target.results[runIndex]?.results.push(...measurement.results);
        target.runtime = measurement.runtime;
      }
    }
    sampleOrder.push({ round: runIndex + 1, benchmarks: benchmarkOrder });
  }

  for (const target of measurementTargets) {
    revisions[target.id] = {
      commit: target.commit,
      engine: target.engine,
      runtime: target.runtime,
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

const evaluation = evaluatePerformance(revisions);

const report = {
  schemaVersion: 3,
  suite: "independent-engine-cross-revision-performance",
  generatedAt: new Date().toISOString(),
  runs: RUNS,
  runIsolation: "fresh-process-per-sample",
  samplingOrder: "deterministic-balanced-revision-interleaving",
  sampleOrder,
  percentileMethod: "linear interpolation between closest ranks",
  memoryMetric:
    "post-GC heap delta per retained public result from an isolated post-warmup fixed-size cohort",
  runtimeHeapConfiguration: Object.freeze({
    maxOldSpaceSizeMb: 256,
    maxSemiSpaceSizeMb: 8
  }),
  baselinePolicy: PERFORMANCE_BASELINES,
  thresholds: PERFORMANCE_THRESHOLDS,
  revisions,
  ...evaluation
};
await writeJson("reports/engine-performance.json", report);
console.log(JSON.stringify(evaluation, null, 2));
if (!report.ok) process.exitCode = 1;
