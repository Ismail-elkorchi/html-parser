import assert from "node:assert/strict";
import test from "node:test";

import { serializeTreeDocument } from "../../dist/internal/serializer/mod.js";
import { tokenize } from "../../dist/internal/tokenizer/mod.js";
import { buildTreeFromTokens, normalizeTree } from "../../dist/internal/tree/mod.js";

function normalize(treeDocument) {
  return JSON.stringify(normalizeTree(treeDocument));
}

test("round trip parse-serialize-parse normalizes stably", () => {
  const firstTokens = tokenize("<div data-k=\"v\">round</div>").tokens;
  const firstTree = buildTreeFromTokens(firstTokens).document;
  const serialized = serializeTreeDocument(firstTree);

  const secondTokens = tokenize(serialized).tokens;
  const secondTree = buildTreeFromTokens(secondTokens).document;

  assert.equal(normalize(firstTree), normalize(secondTree));
});
