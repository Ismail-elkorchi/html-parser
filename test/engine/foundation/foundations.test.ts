import assert from "node:assert/strict";
import test from "node:test";

import {
  createParseError,
  type EngineParseError
} from "../../../src/internal/html-engine/diagnostics.js";
import { HtmlInputCursor, type InputRead } from "../../../src/internal/html-engine/input-cursor.js";
import { runHtmlEngine } from "../../../src/internal/html-engine/parser-driver.js";
import {
  EngineAbortError,
  EngineConfigurationError,
  EngineResourceLimitError,
  createEngineResourceGuard
} from "../../../src/internal/html-engine/resource-guard.js";
import { ENGINE_STANDARD_BASELINE } from "../../../src/internal/html-engine/standards.js";

function drain(cursor: HtmlInputCursor): InputRead[] {
  const reads: InputRead[] = [];
  for (;;) {
    const read = cursor.consume();
    reads.push(read);
    if (read.kind !== "character") return reads;
  }
}

function readEvidence(read: InputRead) {
  return read.kind === "character"
    ? { kind: read.kind, value: read.value, span: read.span }
    : read;
}

void test("foundation pins the complete standards baseline", () => {
  assert.deepEqual(ENGINE_STANDARD_BASELINE, {
    html: "56674fb3ac40279141a202e5d19b84f30d99854d",
    encoding: "a985b62a9b45c17da3e17a9f0a0b4e30c34c4a8a",
    infra: "3f984adcd24a6d5c53cc26b3e737701808003f3e",
    dom: "8a5f57c61ca1de8dc21b7e114501b1b57882e935"
  });
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
    reads.map(readEvidence),
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

  const first = cursor.consume();
  assert.equal(first.kind, "character");
  assert.equal(first.startUtf16Offset, 0);
  assert.equal(first.endUtf16Offset, 2);
  assert.deepEqual(readEvidence(first), {
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

  guard.reserveNodeAtDepth(2);
  assert.throws(
    () => { guard.reserveNodeAtDepth(2); },
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
  depth.reserveNodeAtDepth(1);
  assert.throws(
    () => { depth.observeDepth(2); },
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

void test("production resource accounting can omit the private step metric", () => {
  const resources = createEngineResourceGuard({ trackSteps: false });
  resources.checkpoint();
  resources.reserveNodeAtDepth(2);
  resources.reserveParseError();
  const attributes = resources.beginStartTag();
  attributes.beginAttribute();
  attributes.appendCodePoint("é");
  assert.deepEqual(resources.snapshot(), {
    steps: 0,
    nodes: 1,
    maxDepth: 2,
    parseErrors: 1,
    attributes: 1,
    attributeUtf8Bytes: 2
  });
  assert.throws(
    () => createEngineResourceGuard({ trackSteps: false, limits: { maxSteps: 1 } }),
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
  const runWithUnknownOptions = runHtmlEngine as (options: unknown) => unknown;
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
      runHtmlEngine({
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
