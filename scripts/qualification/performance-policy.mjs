export const PERFORMANCE_THRESHOLDS = Object.freeze({
  minCpuThroughputMedianRatio: 0.9,
  maxMemoryMedianRatio: 1.1,
  maxCpuThroughputRobustSpreadFraction: 0.2,
  maxMemoryRobustSpreadFraction: 0.15
});

export const PERFORMANCE_HISTORICAL_THRESHOLDS = Object.freeze({
  minCpuThroughputMedianRatio: 0.8,
  maxMemoryMedianRatio: 1.3,
  maxCpuThroughputRobustSpreadFraction: 0.25,
  maxMemoryRobustSpreadFraction: 0.15
});

export const PERFORMANCE_BASELINES = Object.freeze({
  parser: Object.freeze({
    id: "independent-parser-base",
    ref: "3363c47dc57609b00e72da5ce562dac083e0590a",
    benchmarks: Object.freeze(["parse-medium", "parse-large"])
  }),
  serializer: Object.freeze({
    id: "corrected-serializer-base",
    ref: "480b404b7c59ab22c3f2d316b36c99414543171a",
    benchmarks: Object.freeze(["serialize-medium", "serialize-large"])
  }),
  historical: Object.freeze({
    id: "historical-v0.1.1",
    ref: "d4b0b69e36cbb4c073074ecc38d9bfd8de4c622d",
    tag: "v0.1.1",
    benchmarks: Object.freeze(["parse-medium", "parse-large"]),
    excludedBenchmarks: Object.freeze({
      "serialize-medium": "the tagged serializer predates the corrected public serialization contract",
      "serialize-large": "the tagged serializer predates the corrected public serialization contract"
    })
  })
});

export const PERFORMANCE_BENCHMARK_NAMES = Object.freeze([
  ...PERFORMANCE_BASELINES.parser.benchmarks,
  ...PERFORMANCE_BASELINES.serializer.benchmarks
]);

function finiteRatio(numerator, denominator) {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    return null;
  }
  return numerator / denominator;
}

function compareBenchmark(candidate, baseline) {
  return {
    cpuThroughputMedianRatio: finiteRatio(
      candidate?.cpuThroughputMbPerSec?.median,
      baseline?.cpuThroughputMbPerSec?.median
    ),
    memoryMedianRatio: finiteRatio(
      candidate?.retainedHeapBytesPerResult?.median,
      baseline?.retainedHeapBytesPerResult?.median
    ),
    baselineCpuThroughputRobustSpreadFraction:
      baseline?.cpuThroughputMbPerSec?.robustSpreadFraction ?? null,
    baselineMemoryRobustSpreadFraction:
      baseline?.retainedHeapBytesPerResult?.robustSpreadFraction ?? null,
    candidateCpuThroughputRobustSpreadFraction:
      candidate?.cpuThroughputMbPerSec?.robustSpreadFraction ?? null,
    candidateMemoryRobustSpreadFraction:
      candidate?.retainedHeapBytesPerResult?.robustSpreadFraction ?? null
  };
}

function thresholdFailures(name, comparison, thresholds, prefix = "") {
  const failures = [];
  const checks = [
    ["cpu-throughput-ratio", comparison.cpuThroughputMedianRatio, (value) =>
      value >= thresholds.minCpuThroughputMedianRatio],
    ["memory-ratio", comparison.memoryMedianRatio, (value) =>
      value <= thresholds.maxMemoryMedianRatio],
    ["baseline-cpu-throughput-spread", comparison.baselineCpuThroughputRobustSpreadFraction,
      (value) => value <= thresholds.maxCpuThroughputRobustSpreadFraction],
    ["baseline-memory-spread", comparison.baselineMemoryRobustSpreadFraction,
      (value) => value <= thresholds.maxMemoryRobustSpreadFraction],
    ["candidate-cpu-throughput-spread", comparison.candidateCpuThroughputRobustSpreadFraction,
      (value) => value <= thresholds.maxCpuThroughputRobustSpreadFraction],
    ["candidate-memory-spread", comparison.candidateMemoryRobustSpreadFraction,
      (value) => value <= thresholds.maxMemoryRobustSpreadFraction]
  ];
  for (const [id, value, passes] of checks) {
    if (typeof value !== "number" || !Number.isFinite(value) || !passes(value)) {
      failures.push(`${prefix}${name}:${id}`);
    }
  }
  return failures;
}

export function evaluatePerformance(
  revisions,
  thresholds = PERFORMANCE_THRESHOLDS,
  historicalThresholds = PERFORMANCE_HISTORICAL_THRESHOLDS
) {
  const candidate = revisions.candidate?.benchmarks ?? {};
  const immediate = {};
  const historical = {};
  const failures = [];

  for (const baseline of [PERFORMANCE_BASELINES.parser, PERFORMANCE_BASELINES.serializer]) {
    const baselineBenchmarks = revisions[baseline.id]?.benchmarks ?? {};
    for (const name of baseline.benchmarks) {
      const comparison = compareBenchmark(candidate[name], baselineBenchmarks[name]);
      immediate[name] = { baseline: baseline.id, enforced: true, ...comparison };
      failures.push(...thresholdFailures(name, comparison, thresholds));
    }
  }

  const historicalBenchmarks = revisions[PERFORMANCE_BASELINES.historical.id]?.benchmarks ?? {};
  for (const name of PERFORMANCE_BASELINES.historical.benchmarks) {
    const comparison = compareBenchmark(candidate[name], historicalBenchmarks[name]);
    historical[name] = {
      baseline: PERFORMANCE_BASELINES.historical.id,
      enforced: true,
      ...comparison
    };
    failures.push(...thresholdFailures(
      name,
      comparison,
      historicalThresholds,
      "historical:"
    ));
  }
  for (const [name, reason] of Object.entries(PERFORMANCE_BASELINES.historical.excludedBenchmarks)) {
    historical[name] = {
      baseline: PERFORMANCE_BASELINES.historical.id,
      enforced: false,
      comparable: false,
      reason
    };
  }

  return {
    comparisons: { immediate, historical },
    failures,
    ok: failures.length === 0
  };
}
