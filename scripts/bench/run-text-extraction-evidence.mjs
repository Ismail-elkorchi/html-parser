import { performance } from "node:perf_hooks";

import {
  VISIBLE_TEXT_HTML_POLICY,
  extractText,
  iterateText,
  parse
} from "../../dist/mod.js";

const SAMPLE_COUNT = 9;
const PROVENANCE_INPUT_SCALARS = 250_000;
const RETAINED_OUTPUT_BYTES = 1_024;
const FALLBACK_ELEMENT_COUNT = 20_000;

if (typeof globalThis.gc !== "function") {
  throw new Error("run with node --expose-gc");
}

function visibleOptions(overrides = {}) {
  return {
    policy: VISIBLE_TEXT_HTML_POLICY,
    maxOutputBytes: RETAINED_OUTPUT_BYTES,
    maxTokens: 1,
    maxFallbackInputBytes: 1_000_000,
    maxFallbackNodes: 100_000,
    ...overrides
  };
}

function drain(iterator) {
  const tokens = [];
  let next = iterator.next();
  while (!next.done) {
    tokens.push(next.value);
    next = iterator.next();
  }
  return { tokens, result: next.value };
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function measureProvenanceRetention() {
  const { tree } = parse(`<p>${"x".repeat(PROVENANCE_INPUT_SCALARS)}</p>`);
  drain(iterateText(tree, visibleOptions()));
  globalThis.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const extracted = drain(iterateText(tree, visibleOptions()));
  globalThis.gc();
  const heapAfter = process.memoryUsage().heapUsed;
  const rangeCount = extracted.tokens.reduce(
    (total, token) => total + token.provenance.length,
    0
  );
  return {
    heapDeltaBytes: heapAfter - heapBefore,
    retainedBytes: Buffer.byteLength(extracted.result.text),
    totalBytes: extracted.result.totalBytes,
    tokenCount: extracted.tokens.length,
    rangeCount,
    truncated: extracted.result.truncated
  };
}

function measureFallbackDeadline() {
  const rawMarkup = "<b>x</b>".repeat(FALLBACK_ELEMENT_COUNT);
  const { tree } = parse(`<body><noscript>${rawMarkup}</noscript></body>`);
  const startedAt = performance.now();
  let failure = null;
  try {
    extractText(tree, visibleOptions({
      maxOutputBytes: 16,
      maxTokens: 4,
      maxTimeMs: 1
    }));
  } catch (error) {
    failure = error;
  }
  return {
    elapsedMs: performance.now() - startedAt,
    code: failure?.code ?? null,
    budget: failure?.budget ?? null
  };
}

const provenanceSamples = [];
for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
  provenanceSamples.push(measureProvenanceRetention());
}
const deadlineSamples = [];
for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
  deadlineSamples.push(measureFallbackDeadline());
}

const report = {
  runtime: process.version,
  platform: `${process.platform}-${process.arch}`,
  sampleCount: SAMPLE_COUNT,
  provenance: {
    inputScalars: PROVENANCE_INPUT_SCALARS,
    retainedOutputLimitBytes: RETAINED_OUTPUT_BYTES,
    medianHeapDeltaBytes: median(provenanceSamples.map((sample) => sample.heapDeltaBytes)),
    samples: provenanceSamples
  },
  fallbackDeadline: {
    elementCount: FALLBACK_ELEMENT_COUNT,
    maxTimeMs: 1,
    medianElapsedMs: median(deadlineSamples.map((sample) => sample.elapsedMs)),
    samples: deadlineSamples
  }
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
