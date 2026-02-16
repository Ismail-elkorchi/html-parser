import assert from "node:assert/strict";
import test from "node:test";

import { BudgetExceededError, chunk, outline, parse, parseBytes, parseStream } from "../../dist/mod.js";

function createByteStream(byteChunks) {
  const streamFactory = globalThis.ReadableStream;
  if (typeof streamFactory !== "function") {
    throw new Error("ReadableStream is unavailable in this runtime");
  }

  return new streamFactory({
    start(controller) {
      for (const value of byteChunks) {
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
  const stream = createByteStream([new Uint8Array([0x61, 0x62]), new Uint8Array([0x63])]);
  const parsed = await parseStream(stream);
  assert.equal(parsed.kind, "document");
  assert.equal(parsed.children[0]?.kind, "element");
});

test("parseStream enforces maxBufferedBytes budget", async () => {
  const stream = createByteStream([new Uint8Array([0x61, 0x62, 0x63])]);
  await assert.rejects(
    parseStream(stream, { budgets: { maxBufferedBytes: 2 } }),
    (error) => {
      assert.ok(error instanceof BudgetExceededError);
      assert.equal(error.payload.budget, "maxBufferedBytes");
      return true;
    }
  );
});

test("parseStream fails once buffered bytes exceed limit during prescan", async () => {
  const payload = new Uint8Array(40).fill(0x61);
  const stream = createByteStream([...payload].map((value) => new Uint8Array([value])));
  await assert.rejects(
    parseStream(stream, { budgets: { maxBufferedBytes: 16 } }),
    (error) => {
      assert.ok(error instanceof BudgetExceededError);
      assert.equal(error.payload.budget, "maxBufferedBytes");
      assert.equal(error.payload.limit, 16);
      assert.equal(error.payload.actual, 17);
      return true;
    }
  );
});

test("parseStream matches parseBytes for chunked transport with sniffing", async () => {
  const prefix = "<meta charset=windows-1252><p>";
  const suffix = "</p>";
  const bytes = new Uint8Array([...asciiBytes(prefix), 0xe9, ...asciiBytes(suffix)]);
  const stream = createByteStream([bytes.subarray(0, 7), bytes.subarray(7, 19), bytes.subarray(19)]);

  const fromBytes = parseBytes(bytes);
  const fromStream = await parseStream(stream);

  assert.deepEqual(fromStream, fromBytes);
});

test("parseStream matches parseBytes across many deterministic chunks", async () => {
  const html = "<!doctype html><table><tr><td>a</td></tr>outside<tr><td>b</td></tr></table>";
  const bytes = new TextEncoder().encode(html);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 2) {
    chunks.push(bytes.subarray(offset, Math.min(bytes.length, offset + 2)));
  }

  const fromBytes = parseBytes(bytes);
  const fromStream = await parseStream(createByteStream(chunks));
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
