import assert from "node:assert/strict";
import test from "node:test";

import { BudgetExceededError, chunk, outline, parse, parseBytes, parseStream } from "../../dist/mod.js";

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

function asciiBytes(value) {
  return Array.from(value, (char) => char.charCodeAt(0));
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

test("parseStream matches parseBytes for chunked transport with sniffing", async () => {
  const prefix = "<meta charset=windows-1252><p>";
  const suffix = "</p>";
  const bytes = new Uint8Array([...asciiBytes(prefix), 0xe9, ...asciiBytes(suffix)]);
  const stream = makeStream([bytes.subarray(0, 7), bytes.subarray(7, 19), bytes.subarray(19)]);

  const fromBytes = parseBytes(bytes);
  const fromStream = await parseStream(stream);

  assert.deepEqual(fromStream, fromBytes);
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
