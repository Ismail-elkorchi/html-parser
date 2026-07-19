import assert from "node:assert/strict";
import test from "node:test";

import {
  HTML_PARSE_ERROR_CODES,
  HTML_STANDARD_REVISION,
  EngineAbortError,
  EngineConfigurationError,
  EngineResourceLimitError,
  HtmlInputCursor,
  createEngineResourceGuard,
  createParseError,
  runEngineFoundationDriver,
  type EngineDocumentDriverConfiguration,
  type EngineParseError,
  type InputRead
} from "../../../src/internal/html-engine/mod.js";

function drain(cursor: HtmlInputCursor): InputRead[] {
  const reads: InputRead[] = [];
  for (;;) {
    const read = cursor.consume();
    reads.push(read);
    if (read.kind !== "character") return reads;
  }
}

void test("foundation pins the current HTML parse-error vocabulary", () => {
  assert.equal(HTML_STANDARD_REVISION, "56674fb3ac40279141a202e5d19b84f30d99854d");
  assert.equal(HTML_PARSE_ERROR_CODES.length, 52);
  assert.equal(new Set(HTML_PARSE_ERROR_CODES).size, HTML_PARSE_ERROR_CODES.length);
  assert.ok(HTML_PARSE_ERROR_CODES.includes("eof-in-processing-instruction"));
});

void test("input cursor normalizes newlines and retains original UTF-16 spans", () => {
  const guard = createEngineResourceGuard();
  const errors: EngineParseError[] = [];
  const cursor = new HtmlInputCursor(guard, (error) => errors.push(error));

  cursor.write("A\r");
  assert.deepEqual(drain(cursor).at(-1), {
    kind: "need-more-input",
    position: { utf16Offset: 1 }
  });
  cursor.write("\nB\rC");
  cursor.close();

  const reads = drain(cursor);
  assert.deepEqual(
    reads,
    [
      {
        kind: "character",
        value: "\n",
        span: { startUtf16Offset: 1, endUtf16Offset: 3 }
      },
      {
        kind: "character",
        value: "B",
        span: { startUtf16Offset: 3, endUtf16Offset: 4 }
      },
      {
        kind: "character",
        value: "\n",
        span: { startUtf16Offset: 4, endUtf16Offset: 5 }
      },
      {
        kind: "character",
        value: "C",
        span: { startUtf16Offset: 5, endUtf16Offset: 6 }
      },
      { kind: "eof", position: { utf16Offset: 6 } }
    ]
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(cursor.consume(), { kind: "eof", position: { utf16Offset: 6 } });
});

void test("input cursor waits across surrogate chunks and reports preprocessing errors once", () => {
  const observed: EngineParseError[] = [];
  const cursor = new HtmlInputCursor(createEngineResourceGuard(), (error) => observed.push(error));
  cursor.write("😀\ud800");

  assert.deepEqual(cursor.consume(), {
    kind: "character",
    value: "😀",
    span: { startUtf16Offset: 0, endUtf16Offset: 2 }
  });
  assert.deepEqual(cursor.consume(), {
    kind: "need-more-input",
    position: { utf16Offset: 2 }
  });

  cursor.write("X\ufdd0\u000b\u0000");
  cursor.close();
  const surrogate = cursor.consume();
  assert.equal(surrogate.kind, "character");
  assert.equal(surrogate.value, "\ud800");
  cursor.reconsumeCurrent();
  assert.deepEqual(cursor.consume(), surrogate);
  assert.deepEqual(drain(cursor).at(-1), { kind: "eof", position: { utf16Offset: 7 } });

  assert.deepEqual(
    observed.map(({ code, span }) => ({ code, span })),
    [
      {
        code: "surrogate-in-input-stream",
        span: { startUtf16Offset: 2, endUtf16Offset: 3 }
      },
      {
        code: "noncharacter-in-input-stream",
        span: { startUtf16Offset: 4, endUtf16Offset: 5 }
      },
      {
        code: "control-character-in-input-stream",
        span: { startUtf16Offset: 5, endUtf16Offset: 6 }
      }
    ]
  );
});

void test("resource limits fail before committing the unavailable unit", () => {
  const guard = createEngineResourceGuard({
    limits: {
      maxSteps: 8,
      maxNodes: 1,
      maxDepth: 2,
      maxParseErrors: 1,
      maxAttributesPerElement: 1,
      maxAttributeUtf8BytesPerElement: 3
    }
  });

  guard.reserveNode(2);
  assert.throws(
    () => { guard.reserveNode(2); },
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxNodes" &&
      error.limit === 1 &&
      error.actual === 2
  );
  assert.equal(guard.snapshot().nodes, 1);

  const attributes = guard.beginStartTag();
  attributes.beginAttribute();
  attributes.appendCodePoint("é");
  assert.throws(
    () => { attributes.appendCodePoint("é"); },
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxAttributeUtf8BytesPerElement" &&
      error.actual === 4
  );
  assert.equal(guard.snapshot().attributeUtf8Bytes, 2);
});

void test("every foundation resource counter enforces zero and exact boundaries", () => {
  const zeroSteps = createEngineResourceGuard({ limits: { maxSteps: 0 } });
  assert.throws(
    () => { zeroSteps.checkpoint(); },
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxSteps" &&
      error.limit === 0 &&
      error.actual === 1
  );
  assert.equal(zeroSteps.snapshot().steps, 0);

  const depth = createEngineResourceGuard({ limits: { maxDepth: 1 } });
  depth.reserveNode(1);
  assert.throws(
    () => { depth.reserveNode(2); },
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxDepth" &&
      error.limit === 1 &&
      error.actual === 2
  );
  assert.deepEqual(depth.snapshot(), {
    steps: 2,
    nodes: 1,
    maxDepth: 1,
    parseErrors: 0,
    attributes: 0,
    attributeUtf8Bytes: 0
  });

  const parseErrors = createEngineResourceGuard({ limits: { maxParseErrors: 0 } });
  assert.throws(
    () => { parseErrors.reserveParseError(); },
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxParseErrors" &&
      error.limit === 0 &&
      error.actual === 1
  );
  assert.equal(parseErrors.snapshot().parseErrors, 0);

  const attributeCount = createEngineResourceGuard({ limits: { maxAttributesPerElement: 1 } });
  const tag = attributeCount.beginStartTag();
  tag.beginAttribute();
  assert.throws(
    () => { tag.beginAttribute(); },
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxAttributesPerElement" &&
      error.limit === 1 &&
      error.actual === 2
  );
  assert.equal(attributeCount.snapshot().attributes, 1);

  assert.throws(
    () => { tag.appendCodePoint("ab"); },
    (error) => error instanceof EngineConfigurationError
  );
});

void test("configuration, abort, deadlines, and observers stop before extra work", () => {
  assert.throws(
    () => createEngineResourceGuard({ limits: { maxSteps: Number.NaN } }),
    (error) => error instanceof EngineConfigurationError
  );

  const reason = Object.freeze({ reason: "stop" });
  const controller = new AbortController();
  controller.abort(reason);
  const aborted = createEngineResourceGuard({ signal: controller.signal });
  assert.throws(
    () => { aborted.checkpoint(); },
    (error) => error instanceof EngineAbortError && error.cause === reason
  );
  assert.equal(aborted.snapshot().steps, 0);

  const deadline = createEngineResourceGuard({
    limits: { maxTimeMs: 0 },
    now: () => 10,
    startedAt: 10
  });
  assert.throws(
    () => { deadline.checkpoint(); },
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxTimeMs" &&
      error.actual === 1
  );
  assert.equal(deadline.snapshot().steps, 0);

  const callbackFailure = new Error("observer failed");
  const diagnostic = createParseError(
    "unexpected-null-character",
    "tokenizer",
    { startUtf16Offset: 0, endUtf16Offset: 1 }
  );
  assert.ok(Object.isFrozen(diagnostic));
  const runWithUnknownOptions = runEngineFoundationDriver as (options: unknown) => unknown;
  assert.throws(
    () =>
      runWithUnknownOptions({
        inputChunks: [],
        parser: { kind: "document", scriptingMode: "inert" },
        unknown: true
      }),
    (error) => error instanceof EngineConfigurationError
  );
  assert.throws(
    () =>
      runEngineFoundationDriver({
        inputChunks: ["\ud800"],
        parser: { kind: "document", scriptingMode: "inert" },
        observer: {
          onParseError() {
            throw callbackFailure;
          }
        }
      }),
    (error) => error === callbackFailure
  );
});

void test("test driver is explicit, deterministic, and does not claim a parser result", () => {
  const result = runEngineFoundationDriver({
    inputChunks: ["<p>", "x</p>"],
    parser: {
      kind: "fragment",
      context: {
        namespaceUri: "http://www.w3.org/1999/xhtml",
        localName: "section"
      },
      scriptingMode: "disabled"
    }
  });

  assert.equal(result.status, "not-implemented");
  assert.equal(result.input, "<p>x</p>");
  assert.deepEqual(result.tokens, []);
  assert.deepEqual(result.parseErrors, []);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.inputCharacters));
});

void test("foundation preprocessing is invariant across adversarial chunk boundaries", () => {
  const input = "A\r\n😀\ud800X\r\ufdd0\u000b\u0000Z";
  const parser = {
    kind: "document",
    scriptingMode: "disabled"
  } satisfies EngineDocumentDriverConfiguration;
  const whole = runEngineFoundationDriver({ inputChunks: [input], parser });
  const chunked = runEngineFoundationDriver({ inputChunks: input.split(""), parser });

  assert.deepEqual(chunked.inputCharacters, whole.inputCharacters);
  assert.deepEqual(chunked.parseErrors, whole.parseErrors);
  assert.equal(chunked.input, whole.input);
});
