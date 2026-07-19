import assert from "node:assert/strict";
import test from "node:test";

import { serializeTreeDocument } from "../../dist/internal/serializer/mod.js";
import { tokenize } from "../../dist/internal/tokenizer/mod.js";
import { buildTreeFromHtml, normalizeTree } from "../../dist/internal/tree/mod.js";

function normalize(treeDocument) {
  return JSON.stringify(normalizeTree(treeDocument));
}

test("round trip parse-serialize-parse normalizes stably", () => {
  const firstTree = buildTreeFromHtml("<div data-k=\"v\">round</div>").document;
  const serialized = serializeTreeDocument(firstTree);

  const secondTree = buildTreeFromHtml(serialized).document;

  assert.equal(normalize(firstTree), normalize(secondTree));
});

test("tokenizer propagates unexpected runtime failures", () => {
  const marker = new Error("initial-state access failed");
  let reads = 0;
  const options = {};
  Object.defineProperty(options, "initialState", {
    get() {
      reads += 1;
      if (reads === 1) {
        throw marker;
      }
      return undefined;
    }
  });

  assert.throws(() => tokenize("<p>x</p>", options), (error) => error === marker);
  assert.equal(reads, 1);
});

test("tokenizer handles long numeric character references without overflow failures", () => {
  const leadingZeroHex = tokenize(`&#x${"0".repeat(256)}41;`).tokens;
  assert.deepEqual(leadingZeroHex, [
    { type: "Character", data: "A" },
    { type: "EOF" }
  ]);

  const outOfRangeDecimal = tokenize(`&#${"9".repeat(400)};`).tokens;
  assert.deepEqual(outOfRangeDecimal, [
    { type: "Character", data: "\uFFFD" },
    { type: "EOF" }
  ]);
});
