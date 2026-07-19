import process from "node:process";
import { performance } from "node:perf_hooks";

import {
  HTML_NAMESPACE,
  HtmlTreeModel,
  createEngineResourceGuard
} from "../../dist/internal/html-engine/mod.js";

if (typeof globalThis.gc !== "function") {
  throw new Error("Run the tree evidence script with --expose-gc");
}

function createElement(model, localName) {
  return model.createElement({
    namespaceUri: HTML_NAMESPACE,
    prefix: null,
    localName,
    qualifiedName: localName
  });
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

const deep = measure("deep-tree", () => {
  const depth = 20_000;
  const resources = createEngineResourceGuard({
    limits: { maxNodes: depth + 1, maxDepth: depth + 1 }
  });
  const model = new HtmlTreeModel({ rootKind: "fragment", resources });
  let parent = model.root;
  for (let index = 0; index < depth; index += 1) {
    const child = createElement(model, "div");
    model.append(parent, child);
    parent = child;
  }
  let traversed = 0;
  for (const entry of model.walk()) traversed += entry.depth > 0 ? 1 : 0;
  return {
    shape: { depth, width: 1 },
    traversed,
    validation: model.validate(),
    resources: resources.snapshot()
  };
});

const wide = measure("wide-tree", () => {
  const width = 50_000;
  const resources = createEngineResourceGuard({
    limits: { maxNodes: width + 1, maxDepth: 2 }
  });
  const model = new HtmlTreeModel({ rootKind: "fragment", resources });
  for (let index = 0; index < width; index += 1) {
    model.append(model.root, createElement(model, "span"));
  }
  return {
    shape: { depth: 1, width },
    lastIdentity: model.root.childAt(width - 1)?.identity.serial ?? null,
    validation: model.validate(),
    resources: resources.snapshot()
  };
});

process.stdout.write(`${JSON.stringify({
  schema: "engine-tree-evidence/v1",
  runtime: process.version,
  cases: [deep, wide]
}, null, 2)}\n`);
