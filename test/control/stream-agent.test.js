import assert from "node:assert/strict";
import test from "node:test";

import {
  BudgetExceededError,
  chunk,
  outline,
  parse,
  parseBytes,
  parseFragment,
  parseStream,
  tokenizeStream
} from "../../dist/mod.js";

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

function createPullCountStream(byteChunks, pullCounter) {
  const streamFactory = globalThis.ReadableStream;
  if (typeof streamFactory !== "function") {
    throw new Error("ReadableStream is unavailable in this runtime");
  }

  let offset = 0;
  return new streamFactory({
    pull(controller) {
      pullCounter.count += 1;
      const value = byteChunks[offset];
      offset += 1;
      if (value === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    }
  }, { highWaterMark: 0 });
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

test("parseStream caps encoding-prescan memory without rejecting the remainder", async () => {
  const stream = createByteStream([new Uint8Array([0x61, 0x62, 0x63])]);
  const parsed = await parseStream(stream, {
    trace: true,
    budgets: { maxBufferedBytes: 2 }
  });
  const bufferedBudget = parsed.trace.find(
    (event) => event.kind === "budget" && event.budget === "maxBufferedBytes"
  );
  assert.equal(bufferedBudget?.actual, 2);
});

test("parseStream budget outcome is independent of upstream chunk boundaries", async () => {
  const bytes = new TextEncoder().encode(`<p>${"x".repeat(20_000)}</p>`);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 1_024) {
    chunks.push(bytes.subarray(offset, offset + 1_024));
  }

  const options = { trace: true, budgets: { maxInputBytes: 30_000, maxBufferedBytes: 16_384 } };
  const chunked = await parseStream(createByteStream(chunks), options);
  const single = await parseStream(createByteStream([bytes]), options);
  assert.deepEqual(chunked, single);
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

test("parseStream aborts before extra pulls when maxInputBytes is exceeded", async () => {
  const pullCounter = { count: 0 };
  const stream = createPullCountStream(
    [new Uint8Array(4).fill(0x61), new Uint8Array(4).fill(0x62), new Uint8Array(4).fill(0x63)],
    pullCounter
  );

  await assert.rejects(
    parseStream(stream, { budgets: { maxInputBytes: 6, maxBufferedBytes: 64 } }),
    (error) => {
      assert.ok(error instanceof BudgetExceededError);
      assert.equal(error.payload.budget, "maxInputBytes");
      return true;
    }
  );

  assert.equal(pullCounter.count, 2);
});

test("parseStream cancels and releases its reader after budget failures", async () => {
  const streamFactory = globalThis.ReadableStream;
  if (typeof streamFactory !== "function") {
    throw new Error("ReadableStream is unavailable in this runtime");
  }

  for (const budgets of [{ maxInputBytes: 1 }, { maxBufferedBytes: -1 }]) {
    let cancellationReason = null;
    const stream = new streamFactory({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel(reason) {
        cancellationReason = reason;
      }
    });

    await assert.rejects(parseStream(stream, { budgets }), BudgetExceededError);
    assert.ok(cancellationReason instanceof BudgetExceededError);
    assert.equal(stream.locked, false);
  }
});

test("parseStream and tokenizeStream release their readers after success", async () => {
  const parseInput = createByteStream([new TextEncoder().encode("<p>parsed</p>")]);
  await parseStream(parseInput);
  assert.equal(parseInput.locked, false);

  const tokenizeInput = createByteStream([new TextEncoder().encode("<p>tokenized</p>")]);
  const tokens = [];
  for await (const token of tokenizeStream(tokenizeInput)) {
    tokens.push(token);
  }
  assert.ok(tokens.length > 0);
  assert.equal(tokenizeInput.locked, false);
});

test("byte and stream traces contain one truthful decode event", async () => {
  const bytes = new Uint8Array([0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]);
  const options = { trace: true, transportEncodingLabel: "windows-1252" };
  const fromBytes = parseBytes(bytes, options);
  const fromStream = await parseStream(createByteStream([bytes]), options);

  for (const tree of [fromBytes, fromStream]) {
    const decodeEvents = tree.trace.filter((event) => event.kind === "decode");
    assert.equal(decodeEvents.length, 1);
    assert.equal(decodeEvents[0].source, "sniff");
    assert.equal(decodeEvents[0].encoding, "windows-1252");
  }
});

test("tokenizeStream yields deterministic token sequence", async () => {
  const encoder = new TextEncoder();
  const chunks = [encoder.encode("<p>"), encoder.encode("alpha"), encoder.encode("</p>")];

  const collect = async () => {
    const tokens = [];
    for await (const token of tokenizeStream(createByteStream(chunks))) {
      tokens.push(token);
    }
    return tokens;
  };

  const first = await collect();
  const second = await collect();
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((entry) => entry.kind),
    ["startTag", "chars", "endTag", "eof"]
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

test("chunk enforces maxBytes when configured", () => {
  const fragment = parseFragment("<p>a</p><p>bb</p><p>ccc</p>", "section");
  const chunks = chunk(fragment, { maxChars: 4096, maxNodes: 32, maxBytes: 20 });
  const encoder = new TextEncoder();

  assert.ok(chunks.length >= 1);
  for (const item of chunks) {
    assert.ok(encoder.encode(item.content).length <= 20);
  }
});
