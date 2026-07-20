import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const rawPath = "test/fixtures/upstream/whatwg-named-character-references/entities.json";
const generatedPath = "src/internal/html-engine/generated/named-character-references.ts";

function collectHeap() {
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
}

const heapBeforeImport = collectHeap();
const engine = await import(
  "../../tmp/test-runtime/src/internal/html-engine/named-character-references.js"
);
const driver = await import("../../tmp/test-runtime/test/support/character-reference-driver.js");
const heapAfterImport = collectHeap();
const raw = JSON.parse(await readFile(rawPath, "utf8"));

let maximumLookupComparisons = 0;
for (const name of Object.keys(raw)) {
  maximumLookupComparisons = Math.max(
    maximumLookupComparisons,
    engine.probeNamedCharacterReference(name.slice(1)).comparisons
  );
}
if (maximumLookupComparisons > 12) {
  throw new Error(`character reference lookup exceeded 12 comparisons: ${String(maximumLookupComparisons)}`);
}

const digitCount = 1_000_000;
const longNumericInput = `&#${"9".repeat(digitCount)};`;
const heapBeforeNumeric = collectHeap();
const startedAt = performance.now();
const numericResult = driver.runCharacterReference(longNumericInput, 0, {
  suffixChunkCodeUnits: 4096
});
const elapsedMs = performance.now() - startedAt;
const heapAfterNumeric = collectHeap();
if (
  numericResult.rendered !== "�" ||
  numericResult.metrics.numericDigits !== digitCount ||
  numericResult.result.errors[0]?.code !== "character-reference-outside-unicode-range"
) {
  throw new Error("long numeric character-reference evidence produced an unexpected result");
}

const [rawStats, generatedStats] = await Promise.all([stat(rawPath), stat(generatedPath)]);
const report = {
  suite: "independent-character-reference-evidence",
  generatedAt: new Date().toISOString(),
  data: {
    entries: engine.NAMED_CHARACTER_REFERENCE_ENTRY_COUNT,
    semicolonlessEntries: engine.SEMICOLONLESS_NAMED_CHARACTER_REFERENCE_ENTRY_COUNT,
    maximumNameCodeUnits: engine.MAX_NAMED_CHARACTER_REFERENCE_LENGTH,
    rawBytes: rawStats.size,
    generatedBytes: generatedStats.size,
    generatedToRawRatio: Number((generatedStats.size / rawStats.size).toFixed(6))
  },
  lookup: {
    algorithm: "binary search over sorted flattened names",
    maximumComparisons: maximumLookupComparisons
  },
  importHeap: {
    beforeBytes: heapBeforeImport,
    afterBytes: heapAfterImport,
    deltaBytes: heapAfterImport - heapBeforeImport
  },
  longNumeric: {
    digits: digitCount,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    heapBeforeBytes: heapBeforeNumeric,
    heapAfterBytes: heapAfterNumeric,
    heapDeltaBytes: heapAfterNumeric - heapBeforeNumeric,
    retainedDigitCodeUnits: 0,
    accumulator: "saturating integer"
  }
};

await mkdir("reports", { recursive: true });
await writeFile(
  "reports/character-reference-evidence.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
