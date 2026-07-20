import assert from "node:assert/strict";
import test from "node:test";

import { collectDocSymbols } from "../../scripts/quality/doc-jsr-shape.mjs";

test("collectDocSymbols reads flat Deno documentation output", () => {
  const flatOutput = { nodes: [{ name: "parse", functionDef: { returnType: "tree" } }] };
  assert.deepEqual(collectDocSymbols(flatOutput), flatOutput.nodes);
});

test("collectDocSymbols normalizes module-scoped Deno documentation output", () => {
  const current = {
    nodes: {
      "file:///mod.ts": {
        imports: [],
        symbols: [
          {
            name: "parse",
            declarations: [
              {
                declarationKind: "export",
                jsDoc: { doc: "Parse HTML" },
                def: { returnType: "tree" }
              }
            ]
          }
        ]
      }
    }
  };

  assert.deepEqual(collectDocSymbols(current), [
    {
      name: "parse",
      jsDoc: { doc: "Parse HTML" },
      functionDef: { returnType: "tree" }
    }
  ]);
});

test("collectDocSymbols rejects unrelated JSON shapes", () => {
  assert.deepEqual(collectDocSymbols(null), []);
  assert.deepEqual(collectDocSymbols({ nodes: { module: { symbols: "invalid" } } }), []);
});
