import assert from "node:assert/strict";
import test from "node:test";

import { buildTreeFromHtml, normalizeTree } from "../../dist/internal/tree/mod.js";

test("frameset fragment context keeps frame node after unmatched close tag", () => {
  const built = buildTreeFromHtml(
    "</frameset><frame>",
    {
      maxNodes: 4000,
      maxDepth: 256,
      maxAttributesPerElement: 256,
      maxAttributeBytes: 65536
    },
    {
      fragmentContextTagName: "frameset",
      scriptingEnabled: true
    }
  );

  assert.equal(normalizeTree(built.document), "| <frame>");
});
