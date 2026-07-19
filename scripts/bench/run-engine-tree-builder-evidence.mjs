import { performance } from "node:perf_hooks";
import process from "node:process";

import { runHtmlEngine } from "../../dist/internal/html-engine/mod.js";

if (typeof globalThis.gc !== "function") {
  throw new Error("Run the tree-builder evidence script with --expose-gc");
}

function measure(name, input) {
  globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  let tokenCount = 0;
  const startedAt = performance.now();
  const result = runHtmlEngine({
    inputChunks: [input],
    parser: { kind: "document", scriptingMode: "disabled" },
    limits: {
      maxSteps: 10_000_000,
      maxNodes: 100_000,
      maxDepth: 20_000,
      maxParseErrors: 100_000,
      maxAttributesPerElement: 10_000,
      maxAttributeUtf8BytesPerElement: 10_000_000
    },
    observer: { onToken() { tokenCount += 1; } }
  });
  const elapsedMs = performance.now() - startedAt;
  globalThis.gc();
  return Object.freeze({
    name,
    inputUtf16CodeUnits: input.length,
    tokenCount,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    heapDeltaBytes: process.memoryUsage().heapUsed - before,
    parseErrors: result.parseErrors.length,
    resources: result.resources,
    validation: result.model.validate()
  });
}

const nestedDepth = 5_000;
const repeatedElements = 10_000;
const errorCount = 10_000;
const cases = [
  measure(
    "nested-elements",
    `<!doctype html>${"<div>".repeat(nestedDepth)}x${"</div>".repeat(nestedDepth)}`
  ),
  measure(
    "whitespace-boundaries",
    `<!doctype html>${"<span>x \n</span>".repeat(repeatedElements)}`
  ),
  measure(
    "error-heavy-end-tags",
    `<!doctype html>${"</unknown>".repeat(errorCount)}`
  )
];

process.stdout.write(`${JSON.stringify({
  schema: "engine-tree-builder-evidence/v1",
  runtime: process.version,
  cases
}, null, 2)}\n`);
