import assert from "node:assert/strict";
import test from "node:test";

import {
  EngineAbortError,
  EngineConfigurationError,
  EngineResourceLimitError,
  HTML_TOKENIZER_STATES,
  HtmlTokenizer,
  createEngineResourceGuard,
  type EngineParseError,
  type HtmlToken
} from "../../../src/internal/html-engine/mod.js";

function tokenizeChunks(
  chunks: readonly string[],
  options: {
    readonly mode?: "data" | "rcdata" | "rawtext" | "script-data" | "plaintext";
    readonly acknowledgeSelfClosing?: boolean;
  } = {}
): {
  readonly tokens: readonly HtmlToken[];
  readonly errors: readonly EngineParseError[];
} {
  const tokens: HtmlToken[] = [];
  const errors: EngineParseError[] = [];
  const tokenizer = new HtmlTokenizer(
    createEngineResourceGuard(),
    {
      accept(token) {
        tokens.push(token);
        return {
          selfClosingAcknowledged: options.acknowledgeSelfClosing ?? true
        };
      }
    },
    {
      initialState: options.mode ?? "data",
      observer: { onParseError: (error) => errors.push(error) }
    }
  );

  for (const chunk of chunks) tokenizer.write(chunk);
  assert.equal(tokenizer.close().status, "done");
  return { tokens, errors };
}

void test("foundational tokenizer waits, coalesces text, consumes references, and freezes tokens", () => {
  const actual = tokenizeChunks(["a&am", "p;<b A=1 a=2 /", ">"]);
  assert.deepEqual(actual.tokens.map((token) => token.kind), [
    "character",
    "start-tag",
    "eof"
  ]);
  assert.deepEqual(actual.tokens[0], {
    kind: "character",
    data: "a&",
    span: { startUtf16Offset: 0, endUtf16Offset: 6 }
  });
  assert.deepEqual(actual.tokens[1], {
    kind: "start-tag",
    name: "b",
    attributes: [
      {
        name: "a",
        value: "1",
        span: { startUtf16Offset: 9, endUtf16Offset: 12 },
        nameSpan: { startUtf16Offset: 9, endUtf16Offset: 10 },
        valueSpan: { startUtf16Offset: 11, endUtf16Offset: 12 }
      }
    ],
    selfClosing: true,
    span: { startUtf16Offset: 6, endUtf16Offset: 19 }
  });
  assert.deepEqual(actual.errors.map((error) => error.code), ["duplicate-attribute"]);
  assert.ok(actual.tokens.every(Object.isFrozen));
  assert.ok(Object.isFrozen((actual.tokens[1] as { readonly attributes: readonly unknown[] }).attributes));
});

void test("foundational tokenizer emits comments, doctypes, exact EOF, and self-closing diagnostics", () => {
  const actual = tokenizeChunks(["<!DOCT", "YPE html PUBLIC '' \"\"><!--x--><q/>"], {
    acknowledgeSelfClosing: false
  });
  assert.deepEqual(actual.tokens.map((token) => token.kind), [
    "doctype",
    "comment",
    "start-tag",
    "eof"
  ]);
  assert.deepEqual(actual.tokens[0], {
    kind: "doctype",
    name: "html",
    publicIdentifier: "",
    systemIdentifier: "",
    forceQuirks: false,
    span: { startUtf16Offset: 0, endUtf16Offset: 28 }
  });
  assert.deepEqual(actual.errors.map((error) => error.code), [
    "non-void-html-element-start-tag-with-trailing-solidus"
  ]);
  assert.deepEqual(actual.tokens.at(-1), {
    kind: "eof",
    span: { startUtf16Offset: 40, endUtf16Offset: 40 }
  });
});

void test("RAWTEXT less-than transitions preserve literal input through EOF", () => {
  const actual = tokenizeChunks(["<"], { mode: "rawtext" });
  assert.deepEqual(actual.tokens, [
    {
      kind: "character",
      data: "<",
      span: { startUtf16Offset: 0, endUtf16Offset: 1 }
    },
    {
      kind: "eof",
      span: { startUtf16Offset: 1, endUtf16Offset: 1 }
    }
  ]);
});

void test("the frozen state inventory and text-mode NUL distinction are exact", () => {
  assert.equal(HTML_TOKENIZER_STATES.length, 85);
  assert.equal(new Set(HTML_TOKENIZER_STATES).size, 85);
  assert.equal(HTML_TOKENIZER_STATES[0], "data-state");
  assert.equal(HTML_TOKENIZER_STATES.at(-1), "numeric-character-reference-end-state");

  const data = tokenizeChunks(["\0"]);
  const rcdata = tokenizeChunks(["\0"], { mode: "rcdata" });
  assert.deepEqual(data.tokens[0], {
    kind: "character",
    data: "\0",
    span: { startUtf16Offset: 0, endUtf16Offset: 1 }
  });
  assert.deepEqual(rcdata.tokens[0], {
    kind: "character",
    data: "\uFFFD",
    span: { startUtf16Offset: 0, endUtf16Offset: 1 }
  });
  assert.deepEqual(data.errors, [{
    code: "unexpected-null-character",
    phase: "tokenizer",
    span: { startUtf16Offset: 0, endUtf16Offset: 1 }
  }]);
  assert.deepEqual(rcdata.errors, data.errors);
});

void test("tag, attribute, comment, and DOCTYPE recovery retains exact diagnostics", () => {
  const attributes = tokenizeChunks(["<z/0  <>"]);
  assert.deepEqual(attributes.errors.map(({ code, span }) => ({ code, span })), [
    {
      code: "unexpected-solidus-in-tag",
      span: { startUtf16Offset: 3, endUtf16Offset: 4 }
    },
    {
      code: "unexpected-character-in-attribute-name",
      span: { startUtf16Offset: 6, endUtf16Offset: 7 }
    }
  ]);
  assert.deepEqual(attributes.tokens[0], {
    kind: "start-tag",
    name: "z",
    attributes: [
      {
        name: "0",
        value: "",
        span: { startUtf16Offset: 3, endUtf16Offset: 4 },
        nameSpan: { startUtf16Offset: 3, endUtf16Offset: 4 },
        valueSpan: null
      },
      {
        name: "<",
        value: "",
        span: { startUtf16Offset: 6, endUtf16Offset: 7 },
        nameSpan: { startUtf16Offset: 6, endUtf16Offset: 7 },
        valueSpan: null
      }
    ],
    selfClosing: false,
    span: { startUtf16Offset: 0, endUtf16Offset: 8 }
  });

  const comment = tokenizeChunks(["<!----!>"]);
  assert.deepEqual(comment.tokens[0], {
    kind: "comment",
    data: "",
    span: { startUtf16Offset: 0, endUtf16Offset: 8 }
  });
  assert.deepEqual(comment.errors.map(({ code, span }) => ({ code, span })), [{
    code: "incorrectly-closed-comment",
    span: { startUtf16Offset: 7, endUtf16Offset: 8 }
  }]);

  const doctype = tokenizeChunks(["<!DOCTYPE html PUBLIC x>"]);
  assert.deepEqual(doctype.tokens[0], {
    kind: "doctype",
    name: "html",
    publicIdentifier: null,
    systemIdentifier: null,
    forceQuirks: true,
    span: { startUtf16Offset: 0, endUtf16Offset: 24 }
  });
  assert.deepEqual(doctype.errors.map(({ code, span }) => ({ code, span })), [{
    code: "missing-quote-before-doctype-public-identifier",
    span: { startUtf16Offset: 22, endUtf16Offset: 23 }
  }]);
});

void test("tree-builder mode feedback affects the next character synchronously", () => {
  const tokens: HtmlToken[] = [];
  const tokenizer = new HtmlTokenizer(
    createEngineResourceGuard(),
    {
      accept(token) {
        tokens.push(token);
        if (token.kind === "start-tag") tokenizer.setMode("plaintext");
        return { selfClosingAcknowledged: true };
      }
    }
  );
  tokenizer.write("<x>&amp;<b>");
  assert.equal(tokenizer.close().status, "done");
  assert.deepEqual(tokens.map((token) => token.kind), ["start-tag", "character", "eof"]);
  assert.deepEqual(tokens[1], {
    kind: "character",
    data: "&amp;<b>",
    span: { startUtf16Offset: 3, endUtf16Offset: 11 }
  });
});

void test("resource, abort, callback, and reentry failures stop before unavailable work", () => {
  assert.throws(
    () => {
      const tokenizer = new HtmlTokenizer(
        createEngineResourceGuard({ limits: { maxAttributesPerElement: 0 } }),
        { accept: () => ({ selfClosingAcknowledged: true }) }
      );
      tokenizer.write("<a b>");
    },
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxAttributesPerElement" &&
      error.actual === 1
  );

  assert.throws(
    () => {
      const tokenizer = new HtmlTokenizer(
        createEngineResourceGuard({ limits: { maxAttributeUtf8BytesPerElement: 1 } }),
        { accept: () => ({ selfClosingAcknowledged: true }) }
      );
      tokenizer.write("<a é>");
    },
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxAttributeUtf8BytesPerElement" &&
      error.actual === 2
  );

  const observerFailure = new Error("tokenizer observer failed");
  let failedTokenizer: HtmlTokenizer | null = null;
  assert.throws(
    () => {
      failedTokenizer = new HtmlTokenizer(
        createEngineResourceGuard(),
        { accept: () => ({ selfClosingAcknowledged: true }) },
        { observer: { onParseError: () => { throw observerFailure; } } }
      );
      failedTokenizer.write("\0");
    },
    (error) => error === observerFailure
  );
  assert.throws(() => failedTokenizer?.close(), (error) => error === observerFailure);

  const reason = Object.freeze({ source: "token observer" });
  const controller = new AbortController();
  assert.throws(
    () => {
      const tokenizer = new HtmlTokenizer(
        createEngineResourceGuard({ signal: controller.signal }),
        { accept: () => ({ selfClosingAcknowledged: true }) },
        { observer: { onToken: () => { controller.abort(reason); } } }
      );
      tokenizer.write("x");
      tokenizer.close();
    },
    (error) => error instanceof EngineAbortError && error.cause === reason
  );

  let reentryFailure: unknown;
  const reentrant = new HtmlTokenizer(
    createEngineResourceGuard(),
    {
      accept() {
        try {
          reentrant.run();
        } catch (error) {
          reentryFailure = error;
          throw error;
        }
        return { selfClosingAcknowledged: true };
      }
    }
  );
  reentrant.write("x");
  assert.throws(
    () => reentrant.close(),
    (error) => error === reentryFailure && error instanceof EngineConfigurationError
  );
  assert.throws(() => reentrant.close(), (error) => error === reentryFailure);
});

void test("completion is idempotent but cannot accept new input", () => {
  const tokens: HtmlToken[] = [];
  const tokenizer = new HtmlTokenizer(
    createEngineResourceGuard(),
    {
      accept(token) {
        tokens.push(token);
        return { selfClosingAcknowledged: true };
      }
    }
  );
  tokenizer.write("");
  const completed = tokenizer.close();
  assert.deepEqual(tokenizer.run(), completed);
  assert.deepEqual(tokenizer.close(), completed);
  assert.deepEqual(tokens.map((token) => token.kind), ["eof"]);
  assert.throws(
    () => tokenizer.write("late"),
    (error) =>
      error instanceof EngineConfigurationError &&
      error.option === "tokenizer"
  );
});
