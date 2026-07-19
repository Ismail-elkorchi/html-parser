import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const DEFAULT_SAMPLES = 7;
const DEFAULT_WARMUPS = 3;

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

function byteChunks(bytes, chunkSize) {
  const chunks = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize)));
  }
  return chunks;
}

function createByteStream(chunks) {
  let index = 0;
  return new globalThis.ReadableStream({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    }
  }, { highWaterMark: 0 });
}

async function collect(iterable) {
  const values = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

function describeError(error) {
  if (!(error instanceof Error)) {
    return { name: typeof error };
  }
  const payload = "payload" in error && typeof error.payload === "object" && error.payload !== null
    ? error.payload
    : undefined;
  return {
    name: error.name,
    ...(typeof error.code === "string" ? { code: error.code } : {}),
    ...(typeof error.budget === "string" ? { budget: error.budget } : {}),
    ...(payload && typeof payload.budget === "string" ? { budget: payload.budget } : {})
  };
}

async function tokenizeAll(tokenize, stream) {
  const result = tokenize(stream);
  if (result && typeof result[Symbol.asyncIterator] === "function") {
    return collect(result);
  }
  return result;
}

async function observeBeforeEof(tokenize, bytes) {
  let controller;
  let pulls = 0;
  const stream = new globalThis.ReadableStream({
    start(value) {
      controller = value;
    },
    pull() {
      pulls += 1;
    }
  }, { highWaterMark: 0 });
  controller.enqueue(bytes);
  let settled = false;
  const first = tokenizeAll(tokenize, stream).then((tokens) => {
    settled = true;
    return tokens[0];
  });
  await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
  const beforeEof = { settled, pulls };
  controller.close();
  const result = await first;
  return {
    beforeEof,
    firstKindAfterEof: result?.kind ?? null
  };
}

async function measureHeap(operation, warmups, samples) {
  for (let index = 0; index < warmups; index += 1) {
    await operation();
  }
  const measurements = [];
  for (let index = 0; index < samples; index += 1) {
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    const started = performance.now();
    const retained = await operation();
    const elapsedMs = performance.now() - started;
    const after = process.memoryUsage().heapUsed;
    measurements.push({ elapsedMs, heapDeltaBytes: Math.max(0, after - before) });
    if (retained === undefined) {
      throw new Error("measured stream operation did not retain a result");
    }
  }
  return {
    medianElapsedMs: Number(median(measurements.map((entry) => entry.elapsedMs)).toFixed(3)),
    medianRetainedHeapDeltaBytes: Math.round(median(
      measurements.map((entry) => entry.heapDeltaBytes)
    ))
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
const publicModule = await import(
  pathToFileURL(`${moduleRoot}/dist/mod.js`).href
);
const { parseStream, serialize } = publicModule;
const usesEagerApi = typeof publicModule.tokenizeByteStreamEager === "function";
const tokenize = usesEagerApi
  ? publicModule.tokenizeByteStreamEager
  : publicModule.tokenizeStream;
if (typeof tokenize !== "function") {
  throw new Error("module does not export a recognized byte-stream tokenizer");
}
const prescanBudgetName = usesEagerApi
  ? "maxEncodingPrescanBytes"
  : "maxBufferedBytes";
const encoder = new TextEncoder();
const treeOf = (result) => result?.tree ?? result;
const fixture = encoder.encode(`<!doctype html><main><p>${"alpha é 漢字 ".repeat(16_384)}</p></main>`);
const parityFixture = new Uint8Array([
  ...encoder.encode("<meta charset=windows-1252><p>"),
  0xe9,
  ...encoder.encode("</p>")
]);

let prescanCap;
try {
  const tree = treeOf(await parseStream(createByteStream([encoder.encode("abcdef")]), {
    trace: "events",
    budgets: { [prescanBudgetName]: 2 }
  }));
  const traceEvents = Array.isArray(tree.trace) ? tree.trace : tree.trace?.events;
  const event = traceEvents?.find((entry) => usesEagerApi
    ? entry.kind === "stream"
    : entry.kind === "budget" && entry.budget === prescanBudgetName);
  prescanCap = {
    outcome: "returned",
    observedBytes: usesEagerApi
      ? event?.encodingPrescanBytes ?? null
      : event?.actual ?? null,
    ...(usesEagerApi
      ? { effectiveLimitBytes: event?.encodingPrescanLimitBytes ?? null }
      : {})
  };
} catch (error) {
  prescanCap = { outcome: "threw", error: describeError(error) };
}

const parseByPattern = {};
const tokensByPattern = {};
for (const [name, chunks] of [
  ["one-byte", byteChunks(parityFixture, 1)],
  ["seven-byte", byteChunks(parityFixture, 7)],
  ["oversized", [parityFixture]]
]) {
  parseByPattern[name] = serialize(treeOf(await parseStream(createByteStream(chunks))));
  tokensByPattern[name] = await tokenizeAll(tokenize, createByteStream(chunks));
}

const report = {
  schemaVersion: 1,
  label,
  revision,
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.architecture ?? process.arch,
    explicitGc: typeof globalThis.gc === "function"
  },
  method: {
    samples,
    warmups,
    eofProbeDelayMs: 25,
    heap: "median heapUsed after result retention minus explicit-GC starting heap"
  },
  behavior: {
    tokenObservation: await observeBeforeEof(tokenize, encoder.encode("<p>first")),
    prescanCap,
    parseChunkPatternParity: new Set(Object.values(parseByPattern)).size === 1,
    tokenChunkPatternParity: new Set(
      Object.values(tokensByPattern).map((tokens) => JSON.stringify(tokens))
    ).size === 1,
    parseByPattern
  },
  resourceEvidence: {
    inputTransportBytes: fixture.byteLength,
    parseFourKiBChunks: await measureHeap(
      () => parseStream(createByteStream(byteChunks(fixture, 4_096))),
      warmups,
      samples
    ),
    tokenizeFourKiBChunks: await measureHeap(
      () => tokenizeAll(tokenize, createByteStream(byteChunks(fixture, 4_096))),
      warmups,
      samples
    )
  }
};

await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Stream-buffer baseline written: ${output}`);
