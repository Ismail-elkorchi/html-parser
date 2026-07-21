import { performance } from "node:perf_hooks";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { parseLongOptions } from "../lib/cli.mjs";
import { stabilizedHeapUsed } from "./performance-measurement.mjs";

const options = parseLongOptions(process.argv.slice(2), {
  "module-root": { type: "string", required: true },
  benchmark: { type: "string" }
}, "benchmark parser");
const moduleRoot = options["module-root"];
const selectedBenchmark = options.benchmark;
const modulePath = `${moduleRoot}/dist/mod.js`;
const module = await import(pathToFileURL(modulePath).href);
const parse = module.parse;
const serialize = module.serialize;
if (typeof parse !== "function") throw new Error("Benchmark parser export missing");
if (typeof serialize !== "function") throw new Error("Benchmark serializer export missing");

const fixtures = Object.freeze([
  Object.freeze({
    name: "parse-medium",
    operation: "parse",
    input: "<div><h1>Title</h1><p>alpha beta gamma</p><ul><li>a</li><li>b</li><li>c</li></ul></div>".repeat(200),
    warmupIterations: 20,
    iterations: 100,
    retainedResultCount: 8
  }),
  Object.freeze({
    name: "parse-large",
    operation: "parse",
    input: "<section><article><h2>x</h2><p>payload</p></article></section>".repeat(1200),
    warmupIterations: 10,
    iterations: 20,
    retainedResultCount: 4
  }),
  Object.freeze({
    name: "serialize-medium",
    operation: "serialize",
    input: "<main><h1>Title</h1><p data-value='a&amp;b'>alpha &lt; beta</p><svg><text>x</text></svg></main>".repeat(160),
    warmupIterations: 20,
    iterations: 120,
    retainedResultCount: 128
  }),
  Object.freeze({
    name: "serialize-large",
    operation: "serialize",
    input: "<section><template><article><h2>x</h2><p>payload</p></article></template></section>".repeat(900),
    warmupIterations: 10,
    iterations: 24,
    retainedResultCount: 32
  })
]);

function prepare(fixture, input = fixture.input) {
  return fixture.operation === "parse" ? input : parse(input).tree;
}

function execute(fixture, prepared) {
  return fixture.operation === "parse" ? parse(prepared) : serialize(prepared);
}

function measureThroughput(fixture) {
  const prepared = prepare(fixture);
  for (let iteration = 0; iteration < fixture.warmupIterations; iteration += 1) {
    execute(fixture, prepared);
  }
  stabilizedHeapUsed();
  let result;
  const cpuBefore = process.cpuUsage();
  const started = performance.now();
  for (let iteration = 0; iteration < fixture.iterations; iteration += 1) {
    result = execute(fixture, prepared);
  }
  return {
    elapsedMs: performance.now() - started,
    cpu: process.cpuUsage(cpuBefore),
    resultSize: typeof result === "string"
      ? result.length
      : (result?.tree?.children?.length ?? null)
  };
}

const results = [];
for (const fixture of fixtures) {
  if (selectedBenchmark !== undefined && fixture.name !== selectedBenchmark) continue;
  const throughput = measureThroughput(fixture);
  stabilizedHeapUsed();
  const retainedInputs = Array.from(
    { length: fixture.retainedResultCount },
    (_, index) => prepare(
      fixture,
      `${fixture.input}<!--retained-${String(index)}-->`
    )
  );
  const retainedHeapBaseline = stabilizedHeapUsed();
  const retainedResults = new Array(fixture.retainedResultCount);
  for (let index = 0; index < retainedResults.length; index += 1) {
    retainedResults[index] = execute(fixture, retainedInputs[index]);
  }
  const retainedHeap = stabilizedHeapUsed();
  const retainedHeapDelta = Math.max(0, retainedHeap.heapUsed - retainedHeapBaseline.heapUsed);
  const totalBytes = fixture.input.length * fixture.iterations;
  const cpuMs = (throughput.cpu.user + throughput.cpu.system) / 1_000;
  results.push({
    name: fixture.name,
    operation: fixture.operation,
    inputBytes: fixture.input.length,
    warmupIterations: fixture.warmupIterations,
    iterations: fixture.iterations,
    elapsedMs: throughput.elapsedMs,
    cpuMs,
    cpuThroughputMbPerSec:
      totalBytes / (1024 * 1024) / (cpuMs / 1_000),
    throughputMbPerSec:
      totalBytes / (1024 * 1024) / (throughput.elapsedMs / 1_000),
    retainedResultCount: retainedResults.length,
    retainedInputPreparation: "caller-owned-inputs-before-baseline",
    retainedHeapBaselineBytes: retainedHeapBaseline.heapUsed,
    retainedHeapBaselineFullGcPasses: retainedHeapBaseline.fullGcPasses,
    retainedHeapBytes: retainedHeap.heapUsed,
    retainedHeapFullGcPasses: retainedHeap.fullGcPasses,
    retainedHeapDeltaBytes: retainedHeapDelta,
    retainedHeapBytesPerResult: retainedHeapDelta / retainedResults.length,
    resultSize: throughput.resultSize
  });
}

if (results.length === 0) {
  throw new Error(`Unknown benchmark: ${String(selectedBenchmark)}`);
}

process.stdout.write(`${JSON.stringify({ implementation: "public", runtime: process.version, results })}\n`);
