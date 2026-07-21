import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePerformance,
  PERFORMANCE_BASELINES,
  PERFORMANCE_HISTORICAL_THRESHOLDS,
  PERFORMANCE_THRESHOLDS
} from "../../scripts/qualification/performance-policy.mjs";
import {
  PERFORMANCE_MEMORY_COLLECTION,
  PERFORMANCE_RETAINED_RESULT_COUNTS
} from "../../scripts/qualification/performance-measurement.mjs";

function benchmark(throughputMedian = 100, memoryMedian = 1_000, spread = 0.05) {
  return {
    throughputMbPerSec: { median: throughputMedian, robustSpreadFraction: spread },
    cpuThroughputMbPerSec: { median: throughputMedian, robustSpreadFraction: spread },
    retainedHeapBytesPerResult: { median: memoryMedian, robustSpreadFraction: spread }
  };
}

function revisions(candidateOverrides = {}, historicalOverrides = {}) {
  const parser = {
    "parse-medium": benchmark(),
    "parse-large": benchmark()
  };
  const serializer = {
    "serialize-medium": benchmark(),
    "serialize-large": benchmark()
  };
  return {
    [PERFORMANCE_BASELINES.parser.id]: { benchmarks: parser },
    [PERFORMANCE_BASELINES.serializer.id]: { benchmarks: serializer },
    [PERFORMANCE_BASELINES.historical.id]: {
      benchmarks: { ...parser, ...historicalOverrides }
    },
    candidate: {
      benchmarks: { ...parser, ...serializer, ...candidateOverrides }
    }
  };
}

test("performance policy enforces immediate and historical parser horizons", () => {
  assert.deepEqual(PERFORMANCE_MEMORY_COLLECTION, {
    fullGcPasses: 8
  });
  assert.deepEqual(PERFORMANCE_RETAINED_RESULT_COUNTS, {
    "parse-medium": 32,
    "parse-large": 8,
    "serialize-medium": 128,
    "serialize-large": 32
  });
  const result = evaluatePerformance(revisions());
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.comparisons.immediate["parse-medium"].enforced, true);
  assert.equal(result.comparisons.immediate["serialize-medium"].enforced, true);
  assert.equal(result.comparisons.historical["parse-medium"].enforced, true);
  assert.deepEqual(result.comparisons.historical["serialize-medium"], {
    baseline: PERFORMANCE_BASELINES.historical.id,
    enforced: false,
    comparable: false,
    reason: "the tagged serializer predates the corrected public serialization contract"
  });
});

test("historical recovery gaps fail the release policy", () => {
  const result = evaluatePerformance(revisions({}, {
    "parse-medium": benchmark(1_000, 100)
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("historical:parse-medium:cpu-throughput-ratio"));
  assert.ok(result.failures.includes("historical:parse-medium:memory-ratio"));
  assert.ok(result.comparisons.historical["parse-medium"].cpuThroughputMedianRatio < 0.2);
  assert.ok(result.comparisons.historical["parse-medium"].memoryMedianRatio > 5);
});

test("controlled immediate threshold failures are exact", () => {
  const result = evaluatePerformance(revisions({
    "parse-medium": benchmark(89, 1_000),
    "parse-large": benchmark(100, 1_101),
    "serialize-medium": benchmark(100, 1_000, 0.201),
    "serialize-large": benchmark(100, 1_000, 0.151)
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures, [
    "parse-medium:cpu-throughput-ratio",
    "parse-large:memory-ratio",
    "serialize-medium:candidate-cpu-throughput-spread",
    "serialize-medium:candidate-memory-spread",
    "serialize-large:candidate-memory-spread"
  ]);
});

test("missing or invalid evidence fails closed", () => {
  const result = evaluatePerformance(revisions({
    "parse-medium": benchmark(100, 0)
  }));
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("parse-medium:memory-ratio"));
  assert.deepEqual(PERFORMANCE_THRESHOLDS, {
    minCpuThroughputMedianRatio: 0.9,
    maxMemoryMedianRatio: 1.1,
    maxCpuThroughputRobustSpreadFraction: 0.2,
    maxMemoryRobustSpreadFraction: 0.15
  });
  assert.deepEqual(PERFORMANCE_HISTORICAL_THRESHOLDS, {
    minCpuThroughputMedianRatio: 0.8,
    maxMemoryMedianRatio: 1.3,
    maxCpuThroughputRobustSpreadFraction: 0.25,
    maxMemoryRobustSpreadFraction: 0.15
  });
});
