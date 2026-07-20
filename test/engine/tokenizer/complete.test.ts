import assert from "node:assert/strict";
import test from "node:test";

import {
  EngineResourceLimitError,
  createEngineResourceGuard,
  type EngineResourceGuard
} from "../../../src/internal/html-engine/resource-guard.js";
import {
  HtmlTokenizer,
  type HtmlTokenizerInitialState
} from "../../../src/internal/html-engine/tokenizer/tokenizer.js";

import type { EngineParseError } from "../../../src/internal/html-engine/diagnostics.js";
import type {
  HtmlProcessingInstructionToken,
  HtmlToken
} from "../../../src/internal/html-engine/tokens.js";

function tokenizeChunks(
  chunks: readonly string[],
  options: {
    readonly initialState?: HtmlTokenizerInitialState;
    readonly lastStartTagName?: string | null;
    readonly foreignContent?: boolean;
  } = {},
  guard: EngineResourceGuard = createEngineResourceGuard()
): { readonly tokens: readonly HtmlToken[]; readonly errors: readonly EngineParseError[] } {
  const tokens: HtmlToken[] = [];
  const errors: EngineParseError[] = [];
  const tokenizer = new HtmlTokenizer(
    guard,
    {
      accept(token) {
        tokens.push(token);
        return true;
      }
    },
    {
      initialState: options.initialState ?? "data",
      lastStartTagName: options.lastStartTagName ?? null,
      foreignContent: options.foreignContent ?? false,
      observer: { onParseError: (error) => errors.push(error) }
    }
  );
  for (const chunk of chunks) tokenizer.write(chunk);
  tokenizer.close();
  return { tokens, errors };
}

function tokenize(
  input: string,
  options: {
    readonly initialState?: HtmlTokenizerInitialState;
    readonly lastStartTagName?: string | null;
    readonly foreignContent?: boolean;
  } = {}
): { readonly tokens: readonly HtmlToken[]; readonly errors: readonly EngineParseError[] } {
  return tokenizeChunks([input], options);
}

function everyCodeUnitPartition(input: string): readonly (readonly string[])[] {
  if (input.length === 0) return Object.freeze([Object.freeze([])]);
  const partitions: string[][] = [];
  const boundaryCount = input.length - 1;
  const variantCount = 2 ** boundaryCount;
  for (let mask = 0; mask < variantCount; mask += 1) {
    const chunks: string[] = [];
    let start = 0;
    for (let boundary = 0; boundary < boundaryCount; boundary += 1) {
      if ((mask & (1 << boundary)) === 0) continue;
      chunks.push(input.slice(start, boundary + 1));
      start = boundary + 1;
    }
    chunks.push(input.slice(start));
    partitions.push(chunks);
  }
  return partitions;
}

void test("RCDATA and RAWTEXT emit only appropriate end tags", () => {
  const matching = tokenize("foo</TiTlE><b>", {
    initialState: "rcdata",
    lastStartTagName: "title"
  });
  assert.deepEqual(matching.tokens.map((token) => token.kind), [
    "character",
    "end-tag",
    "start-tag",
    "eof"
  ]);
  assert.deepEqual(matching.tokens[1], {
    kind: "end-tag",
    name: "title",
    attributes: [],
    selfClosing: false,
    span: { startUtf16Offset: 3, endUtf16Offset: 11 }
  });

  const mismatch = tokenize("</xm>", {
    initialState: "rawtext",
    lastStartTagName: "xmp"
  });
  assert.deepEqual(mismatch.tokens[0], {
    kind: "character",
    data: "</xm>",
    span: { startUtf16Offset: 0, endUtf16Offset: 5 }
  });
});

void test("CDATA entry and foreign-context declaration handling are exact", () => {
  const direct = tokenize("foo]]>bar", { initialState: "cdata-section" });
  assert.deepEqual(direct.tokens.map((token) => token.kind), [
    "character",
    "character",
    "eof"
  ]);
  assert.deepEqual(direct.tokens.slice(0, 2).map((token) =>
    token.kind === "character" ? token.data : null
  ), ["foo", "bar"]);

  const foreign = tokenize("<![CDATA[x]]>", { foreignContent: true });
  assert.deepEqual(foreign.tokens[0], {
    kind: "character",
    data: "x",
    span: { startUtf16Offset: 9, endUtf16Offset: 10 }
  });
  assert.deepEqual(foreign.errors, []);

  const html = tokenize("<![CDATA[x]]>");
  assert.equal(html.tokens[0]?.kind, "comment");
  assert.deepEqual(html.errors.map((error) => error.code), ["cdata-in-html-content"]);
});

void test("processing instructions have a distinct immutable token contract", () => {
  const actual = tokenize("<?target data?>x");
  const instruction = actual.tokens[0] as HtmlProcessingInstructionToken;
  assert.deepEqual(instruction, {
    kind: "processing-instruction",
    target: "target",
    data: "data",
    span: { startUtf16Offset: 0, endUtf16Offset: 15 }
  });
  assert.ok(Object.isFrozen(instruction));
  assert.deepEqual(actual.tokens.map((token) => token.kind), [
    "processing-instruction",
    "character",
    "eof"
  ]);

  const questionable = tokenize("<?target a?b?>");
  assert.deepEqual(questionable.tokens[0], {
    kind: "processing-instruction",
    target: "target",
    data: "a?b",
    span: { startUtf16Offset: 0, endUtf16Offset: 14 }
  });

  const reserved = tokenize("<?XmL?>");
  assert.equal(reserved.tokens[0]?.kind, "comment");
  assert.deepEqual(reserved.errors.map((error) => error.code), [
    "disallowed-processing-instruction-target"
  ]);
});

void test("processing-instruction recovery and EOF diagnostics cover every state", () => {
  const invalidFirst = tokenize("<?1x>");
  assert.deepEqual(invalidFirst.tokens[0], {
    kind: "comment",
    data: "?1x",
    span: { startUtf16Offset: 0, endUtf16Offset: 5 }
  });
  assert.deepEqual(invalidFirst.errors, [{
    code: "invalid-first-character-of-processing-instruction-target",
    phase: "tokenizer",
    span: { startUtf16Offset: 2, endUtf16Offset: 3 }
  }]);

  const invalidTarget = tokenize("<?a:b>");
  assert.deepEqual(invalidTarget.tokens[0], {
    kind: "comment",
    data: "?a:b",
    span: { startUtf16Offset: 0, endUtf16Offset: 6 }
  });
  assert.deepEqual(invalidTarget.errors.map(({ code, span }) => ({ code, span })), [{
    code: "invalid-processing-instruction-target",
    span: { startUtf16Offset: 3, endUtf16Offset: 4 }
  }]);

  const reserved = tokenize("<?XmL-StYlEsHeEt?>");
  assert.equal(reserved.tokens[0]?.kind, "comment");
  assert.deepEqual(reserved.errors.map((error) => error.code), [
    "disallowed-processing-instruction-target"
  ]);

  const eofInputs = ["<?", "<?a", "<?a ", "<?a?"];
  for (const input of eofInputs) {
    const actual = tokenize(input);
    assert.deepEqual(actual.tokens, [{
      kind: "eof",
      span: { startUtf16Offset: input.length, endUtf16Offset: input.length }
    }]);
    assert.deepEqual(actual.errors, [{
      code: "eof-in-processing-instruction",
      phase: "tokenizer",
      span: { startUtf16Offset: input.length, endUtf16Offset: input.length }
    }]);
  }
});

void test("CDATA bracket runs, EOF, and immediate foreign-context feedback are exact", () => {
  const brackets = tokenize("x]]]>", { initialState: "cdata-section" });
  assert.deepEqual(brackets.tokens[0], {
    kind: "character",
    data: "x]",
    span: { startUtf16Offset: 0, endUtf16Offset: 2 }
  });
  assert.deepEqual(brackets.errors, []);

  for (const input of ["x", "x]", "x]]"]) {
    const actual = tokenize(input, { initialState: "cdata-section" });
    assert.deepEqual(actual.tokens[0], {
      kind: "character",
      data: input,
      span: { startUtf16Offset: 0, endUtf16Offset: input.length }
    });
    assert.equal(actual.errors.at(-1)?.code, "eof-in-cdata");
    assert.deepEqual(actual.errors.at(-1)?.span, {
      startUtf16Offset: input.length,
      endUtf16Offset: input.length
    });
  }

  const tokens: HtmlToken[] = [];
  const tokenizer = new HtmlTokenizer(createEngineResourceGuard(), {
    accept(token) {
      tokens.push(token);
      return true;
    }
  });
  tokenizer.write("<![CD");
  tokenizer.setForeignContent(true);
  tokenizer.write("ATA[x]]>");
  tokenizer.close();
  assert.deepEqual(tokens[0], {
    kind: "character",
    data: "x",
    span: { startUtf16Offset: 9, endUtf16Offset: 10 }
  });
});

void test("script escaped and double-escaped paths retain exact EOF diagnostics", () => {
  const escaped = tokenize("<!--<script>x</script>-->", {
    initialState: "script-data",
    lastStartTagName: "script"
  });
  assert.deepEqual(escaped.tokens[0], {
    kind: "character",
    data: "<!--<script>x</script>-->",
    span: { startUtf16Offset: 0, endUtf16Offset: 25 }
  });
  assert.deepEqual(escaped.errors, []);

  const eof = tokenize("<!--x", { initialState: "script-data" });
  assert.deepEqual(eof.errors.map(({ code, span }) => ({ code, span })), [{
    code: "eof-in-script-html-comment-like-text",
    span: { startUtf16Offset: 5, endUtf16Offset: 5 }
  }]);
});

void test("short transition probes match across every possible code-unit partition", () => {
  const probes = [
    { input: "</title>", initialState: "rcdata", lastStartTagName: "title" },
    { input: "</x>", initialState: "rawtext", lastStartTagName: "xmp" },
    { input: "<!--x-->", initialState: "script-data", lastStartTagName: "script" },
    { input: "x]]>y", initialState: "cdata-section" },
    { input: "<?p d?>", initialState: "data" },
    { input: "&amp;", initialState: "rcdata" }
  ] as const satisfies readonly {
    readonly input: string;
    readonly initialState: HtmlTokenizerInitialState;
    readonly lastStartTagName?: string;
  }[];

  for (const probe of probes) {
    const options = {
      initialState: probe.initialState,
      lastStartTagName: "lastStartTagName" in probe ? probe.lastStartTagName : null
    };
    const whole = tokenize(probe.input, options);
    for (const chunks of everyCodeUnitPartition(probe.input)) {
      assert.deepEqual(tokenizeChunks(chunks, options), whole, `${probe.input}: ${JSON.stringify(chunks)}`);
    }
  }
});

void test("complete-state resource limits fail at the first unavailable step", () => {
  const input = "<!--<script>x</script>-->";
  const options = { initialState: "script-data", lastStartTagName: "script" } as const;
  const baselineGuard = createEngineResourceGuard();
  tokenizeChunks([input], options, baselineGuard);
  const baseline = baselineGuard.snapshot();
  assert.ok(baseline.steps > input.length);

  const exactGuard = createEngineResourceGuard({ limits: { maxSteps: baseline.steps } });
  tokenizeChunks([input], options, exactGuard);
  assert.equal(exactGuard.snapshot().steps, baseline.steps);

  assert.throws(
    () => tokenizeChunks(
      [input],
      options,
      createEngineResourceGuard({ limits: { maxSteps: baseline.steps - 1 } })
    ),
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxSteps" &&
      error.limit === baseline.steps - 1 &&
      error.actual === baseline.steps
  );

  assert.throws(
    () => tokenizeChunks(
      ["<!--x"],
      { initialState: "script-data" },
      createEngineResourceGuard({ limits: { maxParseErrors: 0 } })
    ),
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxParseErrors" &&
      error.actual === 1
  );
});

void test("focused deterministic tokenizer fuzzing preserves chunk semantics", () => {
  const alphabet = [
    "a", "Z", "0", "<", ">", "&", ";", "/", "?", "!", "-", "]", "'", '"',
    " ", "\t", "\r", "\n", "\0", "😀", "\ud800", "\udc00", "\ufdd0"
  ];
  const initialStates = [
    "data", "rcdata", "rawtext", "script-data", "plaintext", "cdata-section"
  ] as const satisfies readonly HtmlTokenizerInitialState[];
  let random = 0x5eed1234;
  const next = (): number => {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    return random >>> 0;
  };

  for (let iteration = 0; iteration < 500; iteration += 1) {
    const parts: string[] = [];
    const length = next() % 49;
    for (let index = 0; index < length; index += 1) {
      parts.push(alphabet[next() % alphabet.length] ?? "");
    }
    const input = parts.join("");
    const options = {
      initialState: initialStates[next() % initialStates.length] ?? "data",
      lastStartTagName: (next() & 1) === 0 ? "script" : null,
      foreignContent: (next() & 1) === 0
    };
    const chunks: string[] = [];
    let offset = 0;
    while (offset < input.length) {
      const width = 1 + (next() % 7);
      chunks.push(input.slice(offset, offset + width));
      if ((next() & 3) === 0) chunks.push("");
      offset += width;
    }
    assert.deepEqual(tokenizeChunks(chunks, options), tokenize(input, options));
  }
});
