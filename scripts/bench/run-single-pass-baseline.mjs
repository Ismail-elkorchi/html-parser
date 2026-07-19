import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const DEFAULT_SAMPLES = 7;
const DEFAULT_WARMUPS = 25;

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
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
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

function traceTokenCount(result) {
  const events = Array.isArray(result.trace) ? result.trace : result.trace?.events;
  const event = events?.find((entry) => entry.kind === "token");
  if (!event || typeof event.count !== "number") {
    throw new Error("traced parse did not emit a numeric token count");
  }
  return event.count;
}

function measureFixture(parse, fixture, warmups, samples) {
  let lastResult;
  for (let index = 0; index < warmups; index += 1) {
    lastResult = parse(fixture.html);
  }

  const measurements = [];
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    if (typeof globalThis.gc === "function") {
      globalThis.gc();
    }

    const initialHeapBytes = process.memoryUsage().heapUsed;
    let peakHeapBytes = initialHeapBytes;
    const initialCpu = process.cpuUsage();
    const started = performance.now();

    for (let iterationIndex = 0; iterationIndex < fixture.iterations; iterationIndex += 1) {
      lastResult = parse(fixture.html);
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    }

    const wallMs = performance.now() - started;
    const cpu = process.cpuUsage(initialCpu);
    measurements.push({
      wallMs,
      cpuMs: (cpu.user + cpu.system) / 1_000,
      peakHeapDeltaBytes: Math.max(0, peakHeapBytes - initialHeapBytes)
    });
  }

  if (!lastResult) {
    throw new Error("benchmark fixture produced no result");
  }

  const cpuMs = median(measurements.map((measurement) => measurement.cpuMs));
  const wallMs = median(measurements.map((measurement) => measurement.wallMs));
  const peakHeapDeltaBytes = median(
    measurements.map((measurement) => measurement.peakHeapDeltaBytes)
  );
  const totalBytes = new TextEncoder().encode(fixture.html).byteLength * fixture.iterations;

  return {
    name: fixture.name,
    inputCodeUnits: fixture.html.length,
    inputBytes: new TextEncoder().encode(fixture.html).byteLength,
    iterations: fixture.iterations,
    medianCpuMs: round(cpuMs),
    medianWallMs: round(wallMs),
    medianPeakHeapDeltaBytes: Math.round(peakHeapDeltaBytes),
    cpuMegabytesPerSecond: round(cpuMs === 0 ? 0 : totalBytes / (1024 * 1024) / (cpuMs / 1_000))
  };
}

const moduleRoot = readArgument("module-root");
const label = readArgument("label");
const revision = readArgument("revision");
const output = readArgument("output");
if (!moduleRoot || !label || !revision || !output) {
  throw new Error("--module-root, --label, --revision, and --output are required");
}

const samples = readPositiveInteger("samples", DEFAULT_SAMPLES);
const warmups = readPositiveInteger("warmups", DEFAULT_WARMUPS);
const publicModule = await import(pathToFileURL(`${moduleRoot}/dist/mod.js`).href);
const tokenizerModule = await import(
  pathToFileURL(`${moduleRoot}/dist/internal/tokenizer/mod.js`).href
);

const countFixtures = [
  { name: "empty", html: "", fragmentContext: "div" },
  { name: "ascii", html: "<!doctype html><main><p>alpha &amp; beta</p></main>", fragmentContext: "div" },
  { name: "multibyte", html: "<p>é—漢字🙂</p>", fragmentContext: "div" },
  { name: "rcdata-fragment", html: "a<b>&amp;</b>", fragmentContext: "textarea" },
  { name: "error-heavy", html: "<table><b><p></table></b></p><", fragmentContext: "table" }
];

const tokenCounts = countFixtures.map((fixture) => ({
  name: fixture.name,
  standaloneIncludingEof: tokenizerModule.tokenize(fixture.html).tokens.length,
  documentIncludingEof: traceTokenCount(publicModule.parse(fixture.html, { trace: "events" })),
  fragmentIncludingEof: traceTokenCount(
    publicModule.parseFragment(fixture.html, fixture.fragmentContext, { trace: "events" })
  ),
  fragmentContext: fixture.fragmentContext
}));

const performanceFixtures = [
  {
    name: "ascii",
    html: "<section><h2>Title</h2><p>alpha beta gamma</p></section>".repeat(300),
    iterations: 90
  },
  {
    name: "multibyte",
    html: "<article><h2>Résumé 漢字</h2><p>naïve🙂—café</p></article>".repeat(300),
    iterations: 90
  },
  {
    name: "nested",
    html: `${"<div>".repeat(160)}payload${"</div>".repeat(160)}`,
    iterations: 180
  },
  {
    name: "error-heavy",
    html: "<table><b><p></table></b></p><select><b><option>x</select>".repeat(180),
    iterations: 90
  }
];

const report = {
  schemaVersion: 1,
  label,
  revision,
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    explicitGc: typeof globalThis.gc === "function"
  },
  method: {
    samples,
    warmups,
    sampleIsolation: "explicit GC before each in-process sample",
    cpu: "process.cpuUsage median",
    heap: "median of peak heapUsed minus post-GC starting heap, sampled after each parse"
  },
  tokenCountConvention: "logical context-aware tokens with adjacent character chunks coalesced, including EOF",
  tokenCounts,
  performance: performanceFixtures.map((fixture) =>
    measureFixture(publicModule.parse, fixture, warmups, samples)
  )
};

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Single-pass baseline written: ${output}`);
