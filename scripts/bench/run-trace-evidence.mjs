import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const DEFAULT_SAMPLES = 5;
const DEFAULT_WARMUPS = 2;

function readArgument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function readPositiveInteger(name, fallback) {
  const raw = readArgument(name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive safe integer`);
  }
  return parsed;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function round(value) {
  return Number(value.toFixed(3));
}

function eventsFromResult(result) {
  const tree = result?.tree ?? result;
  if (Array.isArray(tree.trace)) {
    return tree.trace;
  }
  if (tree.trace?.mode === "events") {
    return tree.trace.events;
  }
  throw new Error("event trace result is unavailable");
}

function traceOption(contract, mode) {
  if (contract === "legacy") {
    if (mode !== "events") {
      throw new Error("legacy trace contract has no summary mode");
    }
    return true;
  }
  return mode;
}

function measure(parse, html, options, warmups, samples) {
  for (let index = 0; index < warmups; index += 1) {
    parse(html, options);
  }
  const measurements = [];
  let result;
  for (let index = 0; index < samples; index += 1) {
    globalThis.gc?.();
    const startingHeap = process.memoryUsage().heapUsed;
    const started = performance.now();
    result = parse(html, options);
    const elapsedMs = performance.now() - started;
    const retainedHeapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - startingHeap);
    measurements.push({ elapsedMs, retainedHeapDeltaBytes });
  }
  return {
    result,
    medianElapsedMs: round(median(measurements.map((entry) => entry.elapsedMs))),
    medianRetainedHeapDeltaBytes: Math.round(median(
      measurements.map((entry) => entry.retainedHeapDeltaBytes)
    ))
  };
}

const moduleRoot = readArgument("module-root");
const label = readArgument("label");
const revision = readArgument("revision");
const output = readArgument("output");
const contract = readArgument("contract");
if (!moduleRoot || !label || !revision || !output || !contract) {
  throw new Error("--module-root, --label, --revision, --output, and --contract are required");
}
if (contract !== "legacy" && contract !== "current") {
  throw new Error("--contract must be legacy or current");
}

const samples = readPositiveInteger("samples", DEFAULT_SAMPLES);
const warmups = readPositiveInteger("warmups", DEFAULT_WARMUPS);
const { parse } = await import(pathToFileURL(`${moduleRoot}/dist/mod.js`).href);
const encoder = new TextEncoder();
const multibyteResult = parse("<html><x-é></x-é></html>", {
  trace: traceOption(contract, "events")
});
const multibyteEvents = eventsFromResult(multibyteResult);
const multibyteCanonicalJson = multibyteEvents.map((event) => JSON.stringify(event));

const scaling = [];
for (const size of [250, 500, 1_000, 2_000]) {
  const measured = measure(
    parse,
    "\0".repeat(size),
    { trace: traceOption(contract, "events"), budgets: { maxParseErrors: size + 10 } },
    warmups,
    samples
  );
  scaling.push({
    inputCodeUnits: size,
    eventCount: eventsFromResult(measured.result).length,
    medianElapsedMs: measured.medianElapsedMs,
    medianRetainedHeapDeltaBytes: measured.medianRetainedHeapDeltaBytes
  });
}

const summary = [];
if (contract === "current") {
  for (const size of [250, 1_000, 4_000]) {
    const measured = measure(
      parse,
      "\0".repeat(size),
      { trace: "summary", budgets: { maxParseErrors: size + 10 } },
      warmups,
      samples
    );
    summary.push({
      inputCodeUnits: size,
      eventCount: (measured.result?.tree ?? measured.result).trace?.summary.eventCount ?? null,
      returnedTraceUtf8Bytes: encoder.encode(
        JSON.stringify((measured.result?.tree ?? measured.result).trace)
      ).byteLength,
      medianElapsedMs: measured.medianElapsedMs,
      medianRetainedHeapDeltaBytes: measured.medianRetainedHeapDeltaBytes
    });
  }
}

const report = {
  schemaVersion: 1,
  label,
  revision,
  contract,
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    explicitGc: typeof globalThis.gc === "function"
  },
  method: {
    samples,
    warmups,
    time: "median wall-clock milliseconds",
    heap: "median heapUsed after retained result minus explicit-GC starting heap"
  },
  multibyte: {
    eventCount: multibyteEvents.length,
    jsonCodeUnits: multibyteCanonicalJson.reduce((total, value) => total + value.length, 0),
    canonicalUtf8Bytes: multibyteCanonicalJson.reduce(
      (total, value) => total + encoder.encode(value).byteLength,
      0
    )
  },
  eventScaling: scaling,
  summaryScaling: summary
};

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Trace evidence written: ${output}`);
