import assert from "node:assert/strict";
import test from "node:test";

import {
  HTML_NAMESPACE_URI,
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

test("mandatory BOM detection is independent from the optional meta-prescan cap", async () => {
  const fixtures = [
    {
      bytes: new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x70, 0x3e, 0x78]),
      encoding: "utf-8"
    },
    {
      bytes: new Uint8Array([0xfe, 0xff, 0x00, 0x3c, 0x00, 0x70, 0x00, 0x3e, 0x00, 0x78]),
      encoding: "utf-16be"
    },
    {
      bytes: new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x70, 0x00, 0x3e, 0x00, 0x78, 0x00]),
      encoding: "utf-16le"
    }
  ];
  for (const fixture of fixtures) {
    for (const maxEncodingPrescanBytes of [0, 1, 2]) {
      const result = await parseStream(createByteStream([
        fixture.bytes.subarray(0, 1),
        fixture.bytes.subarray(1, 2),
        fixture.bytes.subarray(2)
      ]), {
        sourceRetention: "text",
        budgets: { maxEncodingPrescanBytes }
      });
      assert.deepEqual(result.metadata.encoding, {
        name: fixture.encoding,
        source: "bom"
      });
      assert.equal(result.sourceText, "<p>x");
      assert.ok(
        result.metadata.resourceUsage.encodingPrescanBytes <= maxEncodingPrescanBytes
      );
    }
  }
});

test("stream decoding commits as soon as BOM precedence and encoding evidence are final", async () => {
  const fixtures = [
    {
      id: "transport",
      bytes: new TextEncoder().encode("<p>transport tail</p>"),
      options: { transportEncodingLabel: "utf-8" },
      expectedDecisionBytes: 1
    },
    {
      id: "meta",
      bytes: new TextEncoder().encode("<meta charset=utf-8><p>meta tail</p>"),
      options: {},
      expectedDecisionBytes: new TextEncoder().encode("<meta charset=utf-8>").byteLength
    }
  ];
  for (const fixture of fixtures) {
    const pullCounter = { count: 0 };
    let decisionPulls = null;
    const chunks = [...fixture.bytes].map((value) => new Uint8Array([value]));
    const result = await parseStream(createPullCountStream(chunks, pullCounter), {
      ...fixture.options,
      budgets: { maxEncodingPrescanBytes: 100 },
      onTraceEvent(event) {
        if (event.kind === "decode") decisionPulls = pullCounter.count;
      }
    });
    assert.equal(decisionPulls, fixture.expectedDecisionBytes, fixture.id);
    assert.ok(decisionPulls < fixture.bytes.byteLength, fixture.id);
    assert.equal(result.metadata.resourceUsage.encodingPrescanBytes, decisionPulls);
  }
});

test("parseStream budget outcome is independent of upstream chunk boundaries", async () => {
  const bytes = new TextEncoder().encode(`<p>${"x".repeat(20_000)}</p>`);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 1_024) {
    chunks.push(bytes.subarray(offset, offset + 1_024));
  }

  const options = {
    trace: "events",
    budgets: {
      maxInputBytes: 30_000,
      maxEncodingPrescanBytes: 16_384,
      maxSteps: 100_000
    }
  };
  const chunked = await parseStream(createByteStream(chunks), options);
  const single = await parseStream(createByteStream([bytes]), options);
  assert.deepEqual(chunked, single);
  assert.ok(chunked.metadata.resourceUsage.steps > 0);
  assert.equal(
    chunked.metadata.resourceUsage.steps,
    parseBytes(bytes, { budgets: { maxSteps: 100_000 } }).metadata.resourceUsage.steps
  );
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

test("parseStream enforces parser work before EOF once encoding is selected", async () => {
  const pullCounter = { count: 0 };
  const stream = createPullCountStream(
    [new TextEncoder().encode("<p>x</p>"), new TextEncoder().encode("unread")],
    pullCounter
  );

  await assert.rejects(
    parseStream(stream, {
      budgets: { maxEncodingPrescanBytes: 0, maxSteps: 30 }
    }),
    (error) => {
      assert.ok(error instanceof HtmlBudgetExceededError);
      assert.equal(error.budget, "maxSteps");
      assert.equal(error.actual, 31);
      return true;
    }
  );
  assert.equal(pullCounter.count, 1);
  assert.equal(stream.locked, false);
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
  const { tokens } = await tokenizeByteStreamEager(tokenizeInput);
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
    first.tokens.map((entry) => entry.kind),
    ["startTag", "chars", "endTag", "eof"]
  );
});

test("eager tokenization exposes exact deterministic work and enforces maxSteps", async () => {
  const input = () => createByteStream([new TextEncoder().encode("<p a=1>x&amp;y</p>")]);
  const untracked = await tokenizeByteStreamEager(input());
  assert.equal(untracked.metadata.resourceUsage.steps, null);
  assert.equal(Object.isFrozen(untracked), true);
  assert.equal(Object.isFrozen(untracked.tokens), true);
  assert.equal(Object.isFrozen(untracked.metadata.resourceUsage), true);

  const measured = await tokenizeByteStreamEager(input(), { budgets: { maxSteps: 1_000 } });
  const steps = measured.metadata.resourceUsage.steps;
  assert.ok(Number.isSafeInteger(steps));
  assert.ok(steps > 0);
  await tokenizeByteStreamEager(input(), { budgets: { maxSteps: steps } });
  await assert.rejects(
    tokenizeByteStreamEager(input(), { budgets: { maxSteps: steps - 1 } }),
    (error) => error instanceof HtmlBudgetExceededError &&
      error.budget === "maxSteps" && error.limit === steps - 1 && error.actual === steps
  );
});

test("eager tokenization is invariant across chunk patterns and single-byte encoding", async () => {
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
  assert.equal(results[0].tokens.find((token) => token.kind === "chars")?.value, "é");
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
  const { tree: fragment } = parseFragment(
    "<p>a</p><p>bb</p><p>ccc</p>",
    { namespaceUri: HTML_NAMESPACE_URI, localName: "section" }
  );
  const chunks = chunk(fragment, { maxChars: 4096, maxNodes: 32, maxBytes: 20 });
  const encoder = new TextEncoder();

  assert.ok(chunks.length >= 1);
  for (const item of chunks) {
    assert.ok(encoder.encode(item.content).length <= 20);
  }
});
