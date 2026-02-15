import assert from "node:assert/strict";
import test from "node:test";

import { BudgetExceededError, chunk, outline, parse, parseStream } from "../../dist/mod.js";

function makeStream(chunks) {
  const streamFactory = globalThis.ReadableStream;
  if (typeof streamFactory !== "function") {
    throw new Error("ReadableStream is unavailable in this runtime");
  }

  return new streamFactory({
    start(controller) {
      for (const value of chunks) {
        controller.enqueue(value);
      }
      controller.close();
    }
  });
}

test("parseStream decodes deterministic output", async () => {
  const stream = makeStream([new Uint8Array([0x61, 0x62]), new Uint8Array([0x63])]);
  const parsed = await parseStream(stream);
  assert.equal(parsed.kind, "document");
  assert.equal(parsed.children[0]?.kind, "element");
});

test("parseStream enforces maxBufferedBytes budget", async () => {
  const stream = makeStream([new Uint8Array([0x61, 0x62, 0x63])]);
  await assert.rejects(
    parseStream(stream, { budgets: { maxBufferedBytes: 2 } }),
    (error) => {
      assert.ok(error instanceof BudgetExceededError);
      assert.equal(error.payload.budget, "maxBufferedBytes");
      return true;
    }
  );
});

test("outline and chunk stay deterministic", () => {
  const parsed = parse("<h1>a</h1><h2>b</h2>");
  const firstOutline = outline(parsed);
  const secondOutline = outline(parsed);
  assert.deepEqual(firstOutline, secondOutline);

  const firstChunks = chunk(parsed, { maxChars: 16, maxNodes: 4 });
  const secondChunks = chunk(parsed, { maxChars: 16, maxNodes: 4 });
  assert.deepEqual(firstChunks, secondChunks);
});
