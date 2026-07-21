import assert from "node:assert/strict";
import test from "node:test";

import { parse, serialize, tokenizeByteStreamEager } from "../../dist/mod.js";

function byteStream(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });
}

test("round trip parse-serialize-parse normalizes stably", () => {
  const firstTree = parse("<div data-k=\"v\">round</div>").tree;
  const serialized = serialize(firstTree);
  const secondTree = parse(serialized).tree;
  assert.equal(serialize(secondTree), serialized);
});

test("tokenizer handles long numeric character references without overflow failures", async () => {
  const leadingZeroHex = await tokenizeByteStreamEager(
    byteStream(`&#x${"0".repeat(256)}41;`)
  );
  assert.deepEqual(leadingZeroHex.tokens, [
    { kind: "chars", value: "A" },
    { kind: "eof" }
  ]);

  const outOfRangeDecimal = await tokenizeByteStreamEager(
    byteStream(`&#${"9".repeat(400)};`)
  );
  assert.deepEqual(outOfRangeDecimal.tokens, [
    { kind: "chars", value: "\uFFFD" },
    { kind: "eof" }
  ]);
});
