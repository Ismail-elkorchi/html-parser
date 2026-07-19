import { performance } from "node:perf_hooks";

import {
  EngineResourceLimitError,
  runHtmlEngine
} from "../../dist/internal/html-engine/mod.js";

function measure(name, html, thresholds) {
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const result = runHtmlEngine({
    inputChunks: [html],
    parser: { kind: "document", scriptingMode: "disabled" },
    limits: {
      maxSteps: thresholds.maxSteps,
      maxNodes: thresholds.maxNodes,
      maxDepth: thresholds.maxDepth,
      maxParseErrors: thresholds.maxParseErrors,
      maxAttributesPerElement: 10_000,
      maxAttributeUtf8BytesPerElement: 10_000_000
    }
  });
  const elapsedMs = performance.now() - startedAt;
  const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
  const validation = result.model.validate();
  if (result.resources.steps > thresholds.maxSteps) throw new Error(`${name}: step threshold exceeded`);
  return Object.freeze({
    name,
    inputUtf16CodeUnits: html.length,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    heapDeltaBytes,
    resources: result.resources,
    attachedNodes: validation.attachedNodes
  });
}

const distinctCount = 5_000;
const distinctFamilies = Array.from(
  { length: distinctCount },
  (_, index) => `<b data-family=${String(index)}>`
).join("") + "x";
const reconstruction = "<p>" + Array.from(
  { length: distinctCount },
  (_, index) => `<b data-family=${String(index)}>`
).join("") + "a<div>x";
const adoptionCount = 5_000;
const repeatedAdoption = "<!doctype html>" + "<b><div>x</b>".repeat(adoptionCount);

const cases = [
  measure("distinct-noah-families", distinctFamilies, {
    maxSteps: 250_000,
    maxNodes: 6_000,
    maxDepth: 6_000,
    maxParseErrors: 10
  }),
  measure("full-formatting-reconstruction", reconstruction, {
    maxSteps: 300_000,
    maxNodes: 12_000,
    maxDepth: 6_000,
    maxParseErrors: 10
  }),
  measure("repeated-adoption", repeatedAdoption, {
    maxSteps: 600_000,
    maxNodes: 25_000,
    maxDepth: 6_000,
    maxParseErrors: 6_000
  })
];

const budgetInput = "<!doctype html>" + "<b><div>x</b>".repeat(200);
const budgetBaseline = runHtmlEngine({
  inputChunks: [budgetInput],
  parser: { kind: "document", scriptingMode: "disabled" }
});
let budgetFailure = null;
try {
  runHtmlEngine({
    inputChunks: [budgetInput],
    parser: { kind: "document", scriptingMode: "disabled" },
    limits: { maxSteps: budgetBaseline.resources.steps - 1 }
  });
} catch (error) {
  if (error instanceof EngineResourceLimitError) {
    budgetFailure = Object.freeze({
      resource: error.resource,
      limit: error.limit,
      actual: error.actual
    });
  } else {
    throw error;
  }
}
if (
  budgetFailure?.resource !== "maxSteps" ||
  budgetFailure.actual !== budgetBaseline.resources.steps
) {
  throw new Error("formatting recovery did not fail at the first unavailable step");
}

console.log(JSON.stringify({
  schema: "engine-formatting-evidence/v1",
  runtime: process.version,
  cases,
  budget: {
    baselineSteps: budgetBaseline.resources.steps,
    failure: budgetFailure
  }
}));
