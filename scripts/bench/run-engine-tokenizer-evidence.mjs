import { createHash } from "node:crypto";
import process from "node:process";
import { performance } from "node:perf_hooks";

import {
  HtmlTokenizer,
  createEngineResourceGuard
} from "../../dist/internal/html-engine/mod.js";

if (typeof globalThis.gc !== "function") {
  throw new Error("Run the tokenizer evidence script with --expose-gc");
}

const cases = Object.freeze([
  {
    name: "character-reference-text",
    input: "alpha&amp;beta\n".repeat(62_500),
    chunkCodeUnits: 4093
  },
  {
    name: "tags-attributes-comments",
    input: "<section data-x='&amp;'><!--text--></section>".repeat(20_000),
    chunkCodeUnits: 4093
  },
  {
    name: "rcdata-end-tags-and-references",
    input: "alpha</x>&amp;".repeat(50_000),
    chunkCodeUnits: 4093,
    tokenizer: { initialState: "rcdata", lastStartTagName: "title" }
  },
  {
    name: "processing-instructions",
    input: "<?target data?>".repeat(30_000),
    chunkCodeUnits: 4093
  }
]);

function chunksOf(input, size) {
  const chunks = [];
  for (let offset = 0; offset < input.length; offset += size) {
    chunks.push(input.slice(offset, offset + size));
  }
  return chunks;
}

function runEvidence(fixture) {
  globalThis.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const hash = createHash("sha256");
  let tokenCount = 0;
  const guard = createEngineResourceGuard();
  const tokenizer = new HtmlTokenizer(
    guard,
    {
      accept(token) {
        tokenCount += 1;
        hash.update(JSON.stringify(token));
        return { selfClosingAcknowledged: true };
      }
    },
    fixture.tokenizer
  );
  const startedAt = performance.now();
  for (const chunk of chunksOf(fixture.input, fixture.chunkCodeUnits)) {
    tokenizer.write(chunk);
  }
  tokenizer.close();
  const elapsedMs = performance.now() - startedAt;
  globalThis.gc();
  const heapAfter = process.memoryUsage().heapUsed;
  return Object.freeze({
    name: fixture.name,
    inputUtf16CodeUnits: fixture.input.length,
    chunkCodeUnits: fixture.chunkCodeUnits,
    tokenCount,
    tokenFingerprint: hash.digest("hex"),
    elapsedMs: Number(elapsedMs.toFixed(3)),
    heapDeltaBytes: heapAfter - heapBefore,
    resources: guard.snapshot()
  });
}

process.stdout.write(`${JSON.stringify({
  schema: "engine-tokenizer-evidence/v1",
  runtime: process.version,
  cases: cases.map(runEvidence)
}, null, 2)}\n`);
