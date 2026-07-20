import { performance } from "node:perf_hooks";
import process from "node:process";

import { HTML_NAMESPACE_URI, parse, parseFragment, serialize, walk } from "../../dist/mod.js";
import { writeJson } from "../eval/eval-primitives.mjs";

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
  const parsed = parse(input, {
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
  const parsed = parse(input, {
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
  const parsed = parseFragment(input, {
    namespaceUri: HTML_NAMESPACE_URI,
    localName: "section"
  }, {
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

const report = {
  schema: "independent-product-evidence/v1",
  runtime: process.version,
  cases: [repeated, templates, fragment]
};
await writeJson("reports/engine-resource-evidence.json", report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
