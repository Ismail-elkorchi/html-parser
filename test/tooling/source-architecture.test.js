import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSourceGraph } from "../../scripts/quality/source-graph.mjs";

test("source graph analysis finds cycles without mistaking documentation text for imports", () => {
  const result = analyzeSourceGraph([
    { filePath: "src/public/a.ts", source: 'import "./b.ts"; // import "./missing.ts"' },
    { filePath: "src/public/b.ts", source: 'export { value } from "./a.ts";' }
  ]);

  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.cycles, [["src/public/a.ts", "src/public/b.ts"]]);
});

test("source graph analysis reports unresolved, reversed, and extra engine ingress", () => {
  const result = analyzeSourceGraph([
    { filePath: "src/mod.ts", source: 'export * from "./internal/html-engine/parser-driver.ts";' },
    {
      filePath: "src/internal/html-engine/parser-driver.ts",
      source: 'import "../../public/leaf.ts"; import "../../public/missing.ts";'
    },
    { filePath: "src/public/leaf.ts", source: "export const value = 1;" }
  ]);

  assert.equal(result.unresolved.length, 1);
  assert.deepEqual(result.layerViolations, [
    {
      filePath: "src/mod.ts",
      dependency: "src/internal/html-engine/parser-driver.ts",
      fromLayer: "entrypoint",
      toLayer: "engine"
    },
    {
      filePath: "src/internal/html-engine/parser-driver.ts",
      dependency: "src/public/leaf.ts",
      fromLayer: "engine",
      toLayer: "public"
    }
  ]);
  assert.deepEqual(result.engineIngress, [{
    filePath: "src/mod.ts",
    dependency: "src/internal/html-engine/parser-driver.ts"
  }]);
});

test("source graph analysis finds modules outside the package entrypoint graph", () => {
  const result = analyzeSourceGraph([
    { filePath: "src/mod.ts", source: 'export * from "./public/reachable.ts";' },
    { filePath: "src/public/reachable.ts", source: "export const value = 1;" },
    { filePath: "src/public/dead.ts", source: "export const dead = true;" }
  ]);

  assert.equal(result.entrypointFound, true);
  assert.deepEqual(result.unreachableFromEntrypoint, ["src/public/dead.ts"]);
});
