import { performance } from "node:perf_hooks";
import process from "node:process";

import {
  parseFragmentWithIndependentEngine,
  parseWithIndependentEngine
} from "../../dist/integration/html-product-adapter.js";
import { serialize, walk } from "../../dist/mod.js";

if (typeof globalThis.gc !== "function") {
  throw new Error("Run the independent product evidence script with --expose-gc");
}

function measure(name, operation) {
  globalThis.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const result = operation();
  const elapsedMs = performance.now() - startedAt;
  globalThis.gc();
  return Object.freeze({
    name,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    ...result
  });
}

const repeatedCount = 10_000;
const repeated = measure("document-convert-and-serialize", () => {
  const input = `<!doctype html><main>${"<p a=é>x&amp;y</p>".repeat(repeatedCount)}</main>`;
  const parsed = parseWithIndependentEngine(input, {
    captureSpans: true,
    budgets: {
      maxInputBytes: 1_000_000,
      maxDecodedUtf8Bytes: 1_000_000,
      maxNodes: 30_010,
      maxDepth: 8,
      maxAttributesPerElement: 1,
      maxAttributeBytes: 3
    }
  });
  let walked = 0;
  walk(parsed.tree, () => { walked += 1; });
  const serialized = serialize(parsed.tree);
  return {
    inputUtf16CodeUnits: input.length,
    serializedUtf16CodeUnits: serialized.length,
    walked,
    resources: parsed.metadata.resourceUsage
  };
});

const templateCount = 2_000;
const templates = measure("template-content-ownership", () => {
  const input = `<!doctype html>${"<template><span>x</span></template>".repeat(templateCount)}`;
  const parsed = parseWithIndependentEngine(input, {
    budgets: { maxNodes: 8_005, maxDepth: 7 }
  });
  let templateContents = 0;
  walk(parsed.tree, (node) => {
    if (node.kind === "templateContent") templateContents += 1;
  });
  return {
    inputUtf16CodeUnits: input.length,
    templateCount,
    templateContents,
    resources: parsed.metadata.resourceUsage
  };
});

const fragmentDepth = 5_000;
const fragment = measure("deep-fragment-conversion", () => {
  const input = `${"<div>".repeat(fragmentDepth)}x${"</div>".repeat(fragmentDepth)}`;
  const parsed = parseFragmentWithIndependentEngine(input, "section", {
    budgets: { maxNodes: fragmentDepth + 4, maxDepth: fragmentDepth + 2 }
  });
  let walked = 0;
  walk(parsed, () => { walked += 1; });
  return {
    inputUtf16CodeUnits: input.length,
    walked,
    serializedUtf16CodeUnits: serialize(parsed).length
  };
});

if (templates.templateContents !== templateCount) {
  throw new Error("template-content ownership was not retained exactly");
}
if (fragment.walked !== fragmentDepth + 1) {
  throw new Error("deep fragment conversion omitted nodes");
}

process.stdout.write(`${JSON.stringify({
  schema: "independent-product-evidence/v1",
  runtime: process.version,
  cases: [repeated, templates, fragment]
}, null, 2)}\n`);
