import { performance } from "node:perf_hooks";
import process from "node:process";

import { SVG_NAMESPACE } from "../../dist/internal/html-engine/namespaces.js";
import { runHtmlEngine } from "../../dist/internal/html-engine/parser-driver.js";
import { EngineResourceLimitError } from "../../dist/internal/html-engine/resource-guard.js";

if (typeof globalThis.gc !== "function") {
  throw new Error("Run the tree-builder evidence script with --expose-gc");
}

function measure(name, input, parser = { kind: "document", scriptingMode: "disabled" }) {
  globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  let tokenCount = 0;
  const startedAt = performance.now();
  const result = runHtmlEngine({
    inputChunks: [input],
    parser,
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
const tableRowCount = 4_000;
const fosterCharacterCount = 20_000;
const nestedTemplateCount = 2_000;
const foreignDepth = 5_000;
const integrationPointCount = 3_000;
const selectedContentReplacementCount = 3_000;
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
  ),
  measure(
    "table-row-construction",
    `<!doctype html><table>${"<tr><td>x".repeat(tableRowCount)}</table>`
  ),
  measure(
    "foster-parented-characters",
    `<!doctype html><table>${"x".repeat(fosterCharacterCount)}</table>`
  ),
  measure(
    "nested-template-cleanup",
    `<!doctype html>${"<template>".repeat(nestedTemplateCount)}<td>x${"</template>".repeat(nestedTemplateCount)}`
  ),
  measure(
    "foreign-fragment-depth",
    `${"<g>".repeat(foreignDepth)}x${"</g>".repeat(foreignDepth)}`,
    {
      kind: "fragment",
      scriptingMode: "disabled",
      context: { namespaceUri: SVG_NAMESPACE, localName: "svg", attributes: [] }
    }
  ),
  measure(
    "foreign-integration-boundaries",
    `<!doctype html>${"<svg><foreignObject><p>x</p></foreignObject></svg>".repeat(integrationPointCount)}`
  ),
  measure(
    "selectedcontent-replacement",
    `<!doctype html><select><button><selectedcontent></button>${"<option selected>x".repeat(selectedContentReplacementCount)}`
  )
];

const tableBudgetInput = `<!doctype html><table>${"x".repeat(200)}<tr><td>y</table>`;
const tableBudgetBaseline = runHtmlEngine({
  inputChunks: [tableBudgetInput],
  parser: { kind: "document", scriptingMode: "disabled" }
});
let tableBudgetFailure = null;
try {
  runHtmlEngine({
    inputChunks: [tableBudgetInput],
    parser: { kind: "document", scriptingMode: "disabled" },
    limits: { maxSteps: tableBudgetBaseline.resources.steps - 1 }
  });
} catch (error) {
  if (!(error instanceof EngineResourceLimitError)) throw error;
  tableBudgetFailure = Object.freeze({
    resource: error.resource,
    limit: error.limit,
    actual: error.actual
  });
}
if (
  tableBudgetFailure?.resource !== "maxSteps" ||
  tableBudgetFailure.actual !== tableBudgetBaseline.resources.steps
) {
  throw new Error("contextual tree construction did not fail at the first unavailable step");
}

const fragmentBudgetInput = "<g><lineargradient viewbox='0 0 1 1'/>x</g>";
const fragmentParser = {
  kind: "fragment",
  scriptingMode: "disabled",
  context: { namespaceUri: SVG_NAMESPACE, localName: "svg", attributes: [] }
};
const fragmentBudgetBaseline = runHtmlEngine({
  inputChunks: [fragmentBudgetInput],
  parser: fragmentParser
});
let fragmentNodeFailure = null;
try {
  runHtmlEngine({
    inputChunks: [fragmentBudgetInput],
    parser: fragmentParser,
    limits: { maxNodes: fragmentBudgetBaseline.resources.nodes - 1 }
  });
} catch (error) {
  if (!(error instanceof EngineResourceLimitError)) throw error;
  fragmentNodeFailure = Object.freeze({
    resource: error.resource,
    limit: error.limit,
    actual: error.actual
  });
}
if (
  fragmentNodeFailure?.resource !== "maxNodes" ||
  fragmentNodeFailure.actual !== fragmentBudgetBaseline.resources.nodes
) {
  throw new Error("fragment construction did not fail at the first unavailable node");
}

process.stdout.write(`${JSON.stringify({
  schema: "engine-tree-builder-evidence/v4",
  runtime: process.version,
  cases,
  contextualBudget: {
    baselineSteps: tableBudgetBaseline.resources.steps,
    failure: tableBudgetFailure
  },
  fragmentBudget: {
    baselineNodes: fragmentBudgetBaseline.resources.nodes,
    failure: fragmentNodeFailure
  }
}, null, 2)}\n`);
