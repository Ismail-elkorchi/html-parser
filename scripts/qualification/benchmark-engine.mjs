import { performance } from "node:perf_hooks";
import process from "node:process";
import { pathToFileURL } from "node:url";

const argumentsByName = new Map(process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf("=");
  return separator < 0
    ? [argument, ""]
    : [argument.slice(0, separator), argument.slice(separator + 1)];
}));
const moduleRoot = argumentsByName.get("--module-root");
const engine = argumentsByName.get("--engine");
if (moduleRoot === undefined || engine !== "public") {
  throw new Error("Usage: benchmark-engine.mjs --module-root=<path> --engine=public");
}
if (typeof globalThis.gc !== "function") {
  throw new Error("benchmark-engine.mjs requires --expose-gc");
}

const modulePath = `${moduleRoot}/dist/mod.js`;
const module = await import(pathToFileURL(modulePath).href);
const parse = module.parse;
if (typeof parse !== "function") throw new Error(`Benchmark parser export missing for ${engine}`);

const fixtures = Object.freeze([
  Object.freeze({
    name: "parse-medium",
    input: "<div><h1>Title</h1><p>alpha beta gamma</p><ul><li>a</li><li>b</li><li>c</li></ul></div>".repeat(200),
    warmupIterations: 20,
    iterations: 100,
    retainedResultCount: 8
  }),
  Object.freeze({
    name: "parse-large",
    input: "<section><article><h2>x</h2><p>payload</p></article></section>".repeat(1200),
    warmupIterations: 10,
    iterations: 20,
    retainedResultCount: 4
  })
]);

const results = [];
for (const fixture of fixtures) {
  for (let iteration = 0; iteration < fixture.warmupIterations; iteration += 1) {
    parse(fixture.input);
  }
  globalThis.gc();
  let retained;
  const cpuBefore = process.cpuUsage();
  const started = performance.now();
  for (let iteration = 0; iteration < fixture.iterations; iteration += 1) {
    retained = parse(fixture.input);
  }
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuBefore);
  const throughputNodeCount = retained?.tree?.children?.length ?? null;
  retained = undefined;
  globalThis.gc();
  const retainedHeapBaseline = process.memoryUsage().heapUsed;
  const retainedResults = new Array(fixture.retainedResultCount);
  for (let index = 0; index < retainedResults.length; index += 1) {
    retainedResults[index] = parse(fixture.input);
  }
  globalThis.gc();
  const retainedHeap = process.memoryUsage().heapUsed;
  const retainedHeapDelta = Math.max(0, retainedHeap - retainedHeapBaseline);
  const totalBytes = fixture.input.length * fixture.iterations;
  results.push({
    name: fixture.name,
    inputBytes: fixture.input.length,
    warmupIterations: fixture.warmupIterations,
    iterations: fixture.iterations,
    elapsedMs,
    cpuMs: (cpu.user + cpu.system) / 1_000,
    throughputMbPerSec: totalBytes / (1024 * 1024) / (elapsedMs / 1_000),
    retainedResultCount: retainedResults.length,
    retainedHeapBaselineBytes: retainedHeapBaseline,
    retainedHeapBytes: retainedHeap,
    retainedHeapDeltaBytes: retainedHeapDelta,
    retainedHeapBytesPerResult: retainedHeapDelta / retainedResults.length,
    retainedNodeCount: retainedResults[0]?.tree?.children?.length ?? throughputNodeCount
  });
}

process.stdout.write(`${JSON.stringify({ engine, runtime: process.version, results })}\n`);
