import assert from "node:assert/strict";
import test from "node:test";

import { analyzeDeclarationGraph } from "../../scripts/build/declaration-graph.mjs";

test("declaration graph follows rewritten TypeScript specifiers and finds private output", () => {
  const result = analyzeDeclarationGraph(new Map([
    ["dist/mod.d.ts", 'export * from "./public/api.ts";'],
    ["dist/public/api.d.ts", 'import type { Value } from "./types.js"; export type { Value };'],
    ["dist/public/types.d.ts", "export interface Value { readonly name: string; }"],
    ["dist/internal/private.d.ts", "export interface PrivateValue {}"]
  ]), "dist/mod.d.ts");

  assert.equal(result.rootFound, true);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.reachable, [
    "dist/mod.d.ts",
    "dist/public/api.d.ts",
    "dist/public/types.d.ts"
  ]);
  assert.deepEqual(result.unreachable, ["dist/internal/private.d.ts"]);
});

test("declaration graph reports a missing root and unresolved relative edge", () => {
  assert.deepEqual(
    analyzeDeclarationGraph(new Map(), "dist/mod.d.ts"),
    { rootFound: false, reachable: [], unresolved: [], unreachable: [] }
  );

  const result = analyzeDeclarationGraph(new Map([
    ["dist/mod.d.ts", 'export * from "./public/missing.ts";']
  ]), "dist/mod.d.ts");
  assert.deepEqual(result.unresolved, [{
    filePath: "dist/mod.d.ts",
    specifier: "./public/missing.ts",
    dependency: "dist/public/missing.d.ts"
  }]);
});
