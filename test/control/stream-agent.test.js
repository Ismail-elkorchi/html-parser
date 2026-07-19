import assert from "node:assert/strict";
import test from "node:test";

import {
  HtmlBudgetExceededError,
  HtmlConfigurationError,
  chunk,
  outline,
  parse,
  parseBytes,
  parseFragment,
  parseStream,
  tokenizeByteStreamEager
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
  const { tree: parsed } = await parseStream(stream);
  assert.equal(parsed.kind, "document");
  assert.equal(parsed.children[0]?.kind, "element");
});

test("parseStream caps encoding-prescan memory without rejecting the remainder", async () => {
  const stream = createByteStream([new Uint8Array([0x61, 0x62, 0x63])]);
  const { tree: parsed } = await parseStream(stream, {
    trace: "events",
    budgets: { maxEncodingPrescanBytes: 2 }
  });
  assert.equal(parsed.trace?.mode, "events");
  const streamTrace = parsed.trace.events.find((event) => event.kind === "stream");
  assert.equal(streamTrace?.encodingPrescanBytes, 2);
  assert.equal(streamTrace?.encodingPrescanLimitBytes, 2);
});

test("stream encoding prescan uses its documented implementation maximum", async () => {
  const bytes = new Uint8Array(20_000).fill(0x61);
  for (const budgets of [{}, { maxEncodingPrescanBytes: 50_000 }]) {
    const { tree: parsed } = await parseStream(createByteStream([bytes]), { trace: "events", budgets });
    assert.equal(parsed.trace?.mode, "events");
    const event = parsed.trace.events.find((entry) => entry.kind === "stream");
    assert.equal(event?.encodingPrescanBytes, 16_384);
    assert.equal(event?.encodingPrescanLimitBytes, 16_384);
  }
});

test("parseStream budget outcome is independent of upstream chunk boundaries", async () => {
  const bytes = new TextEncoder().encode(`<p>${"x".repeat(20_000)}</p>`);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 1_024) {
    chunks.push(bytes.subarray(offset, offset + 1_024));
  }

  const options = { trace: "events", budgets: { maxInputBytes: 30_000, maxEncodingPrescanBytes: 16_384 } };
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

  assert.deepEqual(fromStream.tree, fromBytes.tree);
  assert.equal(fromStream.sourceText, fromBytes.sourceText);
  assert.deepEqual(fromStream.metadata.encoding, fromBytes.metadata.encoding);
  assert.equal(fromStream.metadata.transportByteLength, fromBytes.metadata.transportByteLength);
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
  assert.deepEqual(fromStream.tree, fromBytes.tree);
  assert.equal(fromStream.sourceText, fromBytes.sourceText);
  assert.deepEqual(fromStream.metadata.encoding, fromBytes.metadata.encoding);
  assert.equal(fromStream.metadata.transportByteLength, fromBytes.metadata.transportByteLength);
});

test("parseStream aborts before extra pulls when maxInputBytes is exceeded", async () => {
  const pullCounter = { count: 0 };
  const stream = createPullCountStream(
    [new Uint8Array(4).fill(0x61), new Uint8Array(4).fill(0x62), new Uint8Array(4).fill(0x63)],
    pullCounter
  );

  await assert.rejects(
    parseStream(stream, { budgets: { maxInputBytes: 6, maxEncodingPrescanBytes: 64 } }),
    (error) => {
      assert.ok(error instanceof HtmlBudgetExceededError);
      assert.equal(error.budget, "maxInputBytes");
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

  let cancellationReason = null;
  const stream = new streamFactory({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
    },
    cancel(reason) {
      cancellationReason = reason;
    }
  });

  await assert.rejects(
    parseStream(stream, { budgets: { maxInputBytes: 1 } }),
    HtmlBudgetExceededError
  );
  assert.ok(cancellationReason instanceof HtmlBudgetExceededError);
  assert.equal(stream.locked, false);
});

test("parseStream rejects invalid budgets before reader acquisition", async () => {
  for (const maxEncodingPrescanBytes of [-1, Number.NaN]) {
    let readerAcquisitions = 0;
    const stream = {
      getReader() {
        readerAcquisitions += 1;
        throw new Error("reader must not be acquired");
      }
    };

    await assert.rejects(
      parseStream(stream, { budgets: { maxEncodingPrescanBytes } }),
      HtmlConfigurationError
    );
    assert.equal(readerAcquisitions, 0);
  }
});

test("parseStream and tokenizeByteStreamEager release their readers after success", async () => {
  const parseInput = createByteStream([new TextEncoder().encode("<p>parsed</p>")]);
  await parseStream(parseInput);
  assert.equal(parseInput.locked, false);

  const tokenizeInput = createByteStream([new TextEncoder().encode("<p>tokenized</p>")]);
  const tokens = await tokenizeByteStreamEager(tokenizeInput);
  assert.ok(tokens.length > 0);
  assert.equal(tokenizeInput.locked, false);
});

test("eager stream results remain unobservable until EOF", async () => {
  for (const operation of [
    (stream) => parseStream(stream),
    (stream) => tokenizeByteStreamEager(stream)
  ]) {
    let controller;
    const stream = new globalThis.ReadableStream({
      start(value) {
        controller = value;
      }
    }, { highWaterMark: 0 });
    controller.enqueue(new TextEncoder().encode("<p>pending"));

    let settled = false;
    const result = operation(stream).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
    assert.equal(settled, false);
    assert.equal(stream.locked, true);

    controller.close();
    await result;
    assert.equal(settled, true);
    assert.equal(stream.locked, false);
  }
});

test("byte and stream traces contain one truthful decode event", async () => {
  const bytes = new Uint8Array([0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]);
  const options = { trace: "events", transportEncodingLabel: "windows-1252" };
  const fromBytes = parseBytes(bytes, options);
  const fromStream = await parseStream(createByteStream([bytes]), options);

  for (const { tree } of [fromBytes, fromStream]) {
    assert.equal(tree.trace?.mode, "events");
    const decodeEvents = tree.trace.events.filter((event) => event.kind === "decode");
    assert.equal(decodeEvents.length, 1);
    assert.equal(decodeEvents[0].source, "sniff");
    assert.equal(decodeEvents[0].encoding, "windows-1252");
  }
});

test("tokenizeByteStreamEager returns a deterministic token sequence", async () => {
  const encoder = new TextEncoder();
  const chunks = [encoder.encode("<p>"), encoder.encode("alpha"), encoder.encode("</p>")];

  const collect = () => tokenizeByteStreamEager(createByteStream(chunks));

  const first = await collect();
  const second = await collect();
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((entry) => entry.kind),
    ["startTag", "chars", "endTag", "eof"]
  );
});

test("eager tokenization is invariant across chunk patterns and legacy encoding", async () => {
  const bytes = new Uint8Array([
    ...asciiBytes("<meta charset=windows-1252><p>"),
    0xe9,
    ...asciiBytes("</p>")
  ]);
  const patterns = [
    [...bytes].map((value) => new Uint8Array([value])),
    [bytes.subarray(0, 7), bytes.subarray(7, 19), bytes.subarray(19)],
    [bytes]
  ];
  const results = [];
  for (const pattern of patterns) {
    results.push(await tokenizeByteStreamEager(createByteStream(pattern), {
      budgets: {
        maxInputBytes: bytes.byteLength,
        maxEncodingPrescanBytes: bytes.byteLength,
        maxDecodedUtf8Bytes: bytes.byteLength + 1
      }
    }));
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
  assert.equal(results[0].find((token) => token.kind === "chars")?.value, "é");
});

test("outline and chunk stay deterministic", () => {
  const { tree: parsed } = parse("<h1>a</h1><h2>b</h2>");
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
