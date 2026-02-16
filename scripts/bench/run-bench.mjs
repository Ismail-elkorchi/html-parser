import { performance } from "node:perf_hooks";

import { parse } from "../../dist/mod.js";
import { writeJson } from "../eval/eval-primitives.mjs";

const MEDIUM_SAMPLE = "<div><h1>Title</h1><p>alpha beta gamma</p><ul><li>a</li><li>b</li><li>c</li></ul></div>".repeat(200);
const LARGE_SAMPLE = "<section><article><h2>x</h2><p>payload</p></article></section>".repeat(1200);

function runBenchmark(benchmarkName, htmlSource, iterations) {
  parse(htmlSource);

  const startMem = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    parse(htmlSource);
  }
  const elapsedMs = performance.now() - started;
  const endMem = process.memoryUsage().heapUsed;

  const totalBytes = htmlSource.length * iterations;
  const totalMB = totalBytes / (1024 * 1024);
  const seconds = elapsedMs / 1000;
  const mbPerSec = seconds > 0 ? totalMB / seconds : 0;
  const memoryMB = Math.max(0, endMem - startMem) / (1024 * 1024);

  return {
    name: benchmarkName,
    inputBytes: htmlSource.length,
    iterations,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    mbPerSec: Number(mbPerSec.toFixed(3)),
    memoryMB: Number(memoryMB.toFixed(3))
  };
}

const benchmarks = [
  runBenchmark("parse-medium", MEDIUM_SAMPLE, 400),
  runBenchmark("parse-large", LARGE_SAMPLE, 80)
];

await writeJson("reports/bench.json", {
  suite: "bench",
  timestamp: new Date().toISOString(),
  benchmarks
});

console.log("ACT: Bench complete:", benchmarks.map((entry) => `${entry.name}=${entry.mbPerSec}MB/s`).join(", "));
