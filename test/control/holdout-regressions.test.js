import assert from "node:assert/strict";
import test from "node:test";

import { serializeFixtureTokenStream } from "../../dist/internal/serializer/mod.js";
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

test("serializer omits trailing optional dd end tag but keeps dt end tag", () => {
  assert.equal(serializeFixtureTokenStream([["EndTag", "dd"]], {}), "");
  assert.equal(serializeFixtureTokenStream([["EndTag", "dt"]], {}), "</dt>");
});
