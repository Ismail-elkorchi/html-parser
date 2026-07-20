import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CharacterReferenceConsumer,
  type CharacterReferenceResult
} from "../../../src/internal/html-engine/character-reference-consumer.js";
import { HtmlInputCursor } from "../../../src/internal/html-engine/input-cursor.js";
import {
  MAX_NAMED_CHARACTER_REFERENCE_LENGTH,
  NAMED_CHARACTER_REFERENCE_ENTRY_COUNT,
  SEMICOLONLESS_NAMED_CHARACTER_REFERENCE_ENTRY_COUNT,
  probeNamedCharacterReference
} from "../../../src/internal/html-engine/named-character-references.js";
import {
  EngineAbortError,
  EngineConfigurationError,
  EngineResourceLimitError,
  createEngineResourceGuard,
} from "../../../src/internal/html-engine/resource-guard.js";
import { runCharacterReference } from "../../support/character-reference-driver.js";
import { loadCharacterReferenceFixtures } from "../../support/character-reference-fixtures.js";

import type { EngineParseError } from "../../../src/internal/html-engine/diagnostics.js";

function semanticResult(result: CharacterReferenceResult): unknown {
  if (result.kind === "need-more-input") return result;
  return {
    ...result,
    errors: result.errors.map(({ code, phase, span }) => ({ code, phase, span }))
  };
}

void test("generated table matches every pinned WHATWG input entry", () => {
  const raw = JSON.parse(
    readFileSync(
      "test/fixtures/upstream/whatwg-named-character-references/entities.json",
      "utf8"
    )
  ) as Readonly<Record<string, { readonly characters: string }>>;
  assert.equal(Object.keys(raw).length, NAMED_CHARACTER_REFERENCE_ENTRY_COUNT);
  assert.equal(NAMED_CHARACTER_REFERENCE_ENTRY_COUNT, 2231);
  assert.equal(SEMICOLONLESS_NAMED_CHARACTER_REFERENCE_ENTRY_COUNT, 106);
  assert.equal(MAX_NAMED_CHARACTER_REFERENCE_LENGTH, 32);

  let maximumComparisons = 0;
  for (const [key, entry] of Object.entries(raw)) {
    const probe = probeNamedCharacterReference(key.slice(1));
    assert.equal(probe.value, entry.characters, key);
    assert.equal(probe.hasPrefix, true, key);
    maximumComparisons = Math.max(maximumComparisons, probe.comparisons);
  }
  assert.ok(maximumComparisons <= 12, `maximum binary-search comparisons: ${String(maximumComparisons)}`);
  assert.deepEqual(probeNamedCharacterReference("CounterClockwiseContourIntegral;"), {
    value: "∳",
    hasPrefix: true,
    comparisons: probeNamedCharacterReference("CounterClockwiseContourIntegral;").comparisons
  });
  assert.deepEqual(probeNamedCharacterReference("NotEqualTilde;").value, "≂̸");
});

void test("all pinned standalone named and numeric fixtures match in whole and unit chunks", () => {
  const fixtures = loadCharacterReferenceFixtures();
  assert.equal(fixtures.length, 4617);

  for (const fixture of fixtures) {
    const whole = runCharacterReference(fixture.input);
    assert.equal(whole.rendered, fixture.expected, `${fixture.id} whole output`);
    assert.deepEqual(
      whole.result.errors.map((error) => error.code),
      fixture.errors,
      `${fixture.id} whole errors`
    );

    const unit = runCharacterReference(fixture.input, 0, { suffixChunkCodeUnits: 1 });
    assert.equal(unit.rendered, fixture.expected, `${fixture.id} unit output`);
    assert.deepEqual(semanticResult(unit.result), semanticResult(whole.result), fixture.id);
    assert.equal(unit.remainder, whole.remainder, fixture.id);
  }
});

void test("attribute ambiguity preserves the nine pinned quoted and unquoted cases", () => {
  const cases = [
    { input: "&noti;\"", expected: "&noti;\"" },
    { input: "&lang=\"", expected: "&lang=\"" },
    { input: "&not=\"", expected: "&not=\"" },
    { input: "&noti;'", expected: "&noti;'" },
    { input: "&lang='", expected: "&lang='" },
    { input: "&not='", expected: "&not='" },
    { input: "&noti;>", expected: "&noti;>" },
    { input: "&lang=>", expected: "&lang=>" },
    { input: "&not=>", expected: "&not=>" }
  ];
  for (const fixture of cases) {
    const actual = runCharacterReference(fixture.input, 0, {
      context: "attribute",
      suffixChunkCodeUnits: 1
    });
    assert.equal(actual.rendered, fixture.expected, fixture.input);
    assert.deepEqual(actual.result.errors, [], fixture.input);
  }

  const data = runCharacterReference("&notit;");
  assert.equal(data.rendered, "¬it;");
  assert.equal(data.result.consumedUtf16, 3);
  assert.deepEqual(data.result.errors, [
    {
      code: "missing-semicolon-after-character-reference",
      phase: "tokenizer",
      span: { startUtf16Offset: 4, endUtf16Offset: 4 }
    }
  ]);
  const attribute = runCharacterReference("&notit;", 0, { context: "attribute" });
  assert.equal(attribute.rendered, "&notit;");
  assert.equal(attribute.result.consumedUtf16, 3);
  assert.deepEqual(attribute.result.errors, []);
});

void test("literal, unknown, entry, and absence paths preserve exact remainder and spans", () => {
  const unknown = runCharacterReference("xy&bogus;!", 2, { suffixChunkCodeUnits: 1 });
  assert.equal(unknown.result.kind, "literal");
  assert.equal(unknown.result.value, "&bogus");
  assert.equal(unknown.result.consumedUtf16, 5);
  assert.deepEqual(unknown.result.span, { startUtf16Offset: 2, endUtf16Offset: 8 });
  assert.deepEqual(unknown.result.errors, [
    {
      code: "unknown-named-character-reference",
      phase: "tokenizer",
      span: { startUtf16Offset: 8, endUtf16Offset: 9 }
    }
  ]);
  assert.equal(unknown.remainder, ";!");

  const noDigits = runCharacterReference("&#x;!");
  assert.equal(noDigits.result.kind, "literal");
  assert.equal(noDigits.result.value, "&#x");
  assert.equal(noDigits.result.consumedUtf16, 2);
  assert.deepEqual(noDigits.result.errors[0]?.span, {
    startUtf16Offset: 3,
    endUtf16Offset: 3
  });
  assert.equal(noDigits.remainder, ";!");

  for (const input of ["&", "&\t", "&\n", "&\r", "& ", "&<", "&&", "&\""]) {
    const result = runCharacterReference(input, 0, {
      additionalAllowedCharacter: input === "&\"" ? "\"" : null
    });
    assert.equal(result.result.kind, "literal", JSON.stringify(input));
    assert.equal(result.result.value, "&", JSON.stringify(input));
    assert.equal(result.result.consumedUtf16, 0, JSON.stringify(input));
  }
});

void test("numeric replacement categories and Windows-1252 values are exact", () => {
  const cases = [
    ["&#0;", "�", "null-character-reference"],
    ["&#x110000;", "�", "character-reference-outside-unicode-range"],
    ["&#xD800;", "�", "surrogate-character-reference"],
    ["&#xFDD0;", "\uFDD0", "noncharacter-character-reference"],
    ["&#13;", "\r", "control-character-reference"],
    ["&#128;", "€", "control-character-reference"],
    ["&#x9F;", "Ÿ", "control-character-reference"],
    ["&#9;", "\t", null],
    ["&#x1F600;", "😀", null]
  ] as const;
  for (const [input, expected, error] of cases) {
    const actual = runCharacterReference(input, 0, { suffixChunkCodeUnits: 1 });
    assert.equal(actual.rendered, expected, input);
    assert.deepEqual(
      actual.result.errors.map((diagnostic) => diagnostic.code),
      error === null ? [] : [error],
      input
    );
  }

  const missing = runCharacterReference("&#65!");
  assert.equal(missing.rendered, "A!");
  assert.deepEqual(missing.result.errors, [
    {
      code: "missing-semicolon-after-character-reference",
      phase: "tokenizer",
      span: { startUtf16Offset: 4, endUtf16Offset: 4 }
    }
  ]);
});

void test("long numeric input saturates without retaining digits or hanging", () => {
  const digitCount = 100_000;
  const actual = runCharacterReference(`&#${"9".repeat(digitCount)};`, 0, {
    suffixChunkCodeUnits: 257
  });
  assert.equal(actual.rendered, "�");
  assert.equal(actual.metrics.numericDigits, digitCount);
  assert.equal(actual.metrics.maximumNamedCandidateCodeUnits, 0);
  assert.deepEqual(actual.result.errors.map((error) => error.code), [
    "character-reference-outside-unicode-range"
  ]);

  const unknownLength = 50_000;
  const unknown = runCharacterReference(`&${"q".repeat(unknownLength)}!`, 0, {
    suffixChunkCodeUnits: 509
  });
  assert.equal(unknown.result.kind, "literal");
  assert.equal(unknown.result.value.length, unknownLength + 1);
  assert.equal(unknown.metrics.literalCodeUnits, unknownLength + 1);
  assert.equal(unknown.remainder, "!");
});

void test("prefix and terminator fuzz is invariant across chunking", () => {
  let state = 0x1f2e3d4c;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789;=!?";
  for (let index = 0; index < 1000; index += 1) {
    let suffix = "";
    const length = index % 40;
    for (let offset = 0; offset < length; offset += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      suffix += alphabet.charAt(state % alphabet.length);
    }
    const input = `&${suffix}`;
    const whole = runCharacterReference(input);
    const unit = runCharacterReference(input, 0, { suffixChunkCodeUnits: 1 });
    assert.deepEqual(semanticResult(unit.result), semanticResult(whole.result), input);
    assert.equal(unit.remainder, whole.remainder, input);
  }
});

void test("lookahead and consumer resource boundaries fail before unavailable work", () => {
  const lookaheadErrors: EngineParseError[] = [];
  const lookaheadGuard = createEngineResourceGuard();
  const lookaheadCursor = new HtmlInputCursor(
    lookaheadGuard,
    (error) => lookaheadErrors.push(error)
  );
  lookaheadCursor.write("&\r");
  assert.equal(lookaheadCursor.consume().kind, "character");
  assert.deepEqual(lookaheadCursor.peekCodeUnit(), {
    kind: "code-unit",
    value: 0x0d,
    position: { utf16Offset: 1 }
  });
  assert.deepEqual(lookaheadCursor.position(), { utf16Offset: 1 });
  assert.deepEqual(lookaheadErrors, []);
  lookaheadCursor.close();
  assert.equal(lookaheadCursor.consume().kind, "character");

  const baseline = runCharacterReference("&amp;");
  const exact = runCharacterReference("&amp;", 0, {
    guard: { limits: { maxSteps: baseline.resources.steps } }
  });
  assert.equal(exact.rendered, "&");
  assert.throws(
    () => runCharacterReference("&amp;", 0, {
      guard: { limits: { maxSteps: 0 } }
    }),
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxSteps" &&
      error.limit === 0 &&
      error.actual === 1
  );
  assert.throws(
    () => runCharacterReference("&amp;", 0, {
      guard: { limits: { maxSteps: baseline.resources.steps - 1 } }
    }),
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxSteps" &&
      error.actual === baseline.resources.steps
  );
  assert.throws(
    () => runCharacterReference("&amp", 0, {
      guard: { limits: { maxParseErrors: 0 } }
    }),
    (error) =>
      error instanceof EngineResourceLimitError &&
      error.resource === "maxParseErrors" &&
      error.actual === 1
  );
});

void test("parse-error observer values are frozen and thrown identity is preserved", () => {
  const observed: EngineParseError[] = [];
  const result = runCharacterReference("&amp", 0, {
    onParseError(error) {
      assert.ok(Object.isFrozen(error));
      observed.push(error);
    }
  });
  assert.deepEqual(observed, result.result.errors);
  assert.ok(Object.isFrozen(result.result));
  assert.ok(Object.isFrozen(result.result.errors));

  const failure = new Error("character reference observer failed");
  let failedConsumer: CharacterReferenceConsumer | null = null;
  assert.throws(
    () => {
      const guard = createEngineResourceGuard();
      const cursor = new HtmlInputCursor(guard);
      cursor.write("&amp");
      cursor.close();
      cursor.consume();
      failedConsumer = new CharacterReferenceConsumer(cursor, guard, {
        context: "text",
        ampersandSpan: { startUtf16Offset: 0, endUtf16Offset: 1 },
        onParseError() {
          throw failure;
        }
      });
      failedConsumer.step();
    },
    (error) => error === failure
  );
  assert.throws(() => failedConsumer?.step(), (error) => error === failure);

  const reason = Object.freeze({ source: "character reference observer" });
  const controller = new AbortController();
  assert.throws(
    () => runCharacterReference("&amp", 0, {
      guard: { signal: controller.signal },
      onParseError() {
        controller.abort(reason);
      }
    }),
    (error) => error instanceof EngineAbortError && error.cause === reason
  );

  const guard = createEngineResourceGuard();
  const cursor = new HtmlInputCursor(guard);
  cursor.write("&amp");
  cursor.close();
  cursor.consume();
  const reentrantHolder: { consumer: CharacterReferenceConsumer | null } = { consumer: null };
  const reentrantConsumer = new CharacterReferenceConsumer(cursor, guard, {
    context: "text",
    ampersandSpan: { startUtf16Offset: 0, endUtf16Offset: 1 },
    onParseError() {
      const activeConsumer = reentrantHolder.consumer;
      if (activeConsumer === null) throw new Error("reentrant test invariant violated");
      activeConsumer.step();
    }
  });
  reentrantHolder.consumer = reentrantConsumer;
  assert.throws(
    () => reentrantConsumer.step(),
    (error) =>
      error instanceof EngineConfigurationError &&
      error.option === "character reference consumer"
  );
});

void test("consumer waits without duplicate work at every boundary of the longest name", () => {
  const input = "&CounterClockwiseContourIntegral;!";
  const unit = runCharacterReference(input, 0, { suffixChunkCodeUnits: 1 });
  const whole = runCharacterReference(input);
  assert.deepEqual(semanticResult(unit.result), semanticResult(whole.result));
  assert.equal(unit.rendered, "∳!");
  assert.equal(unit.metrics.maximumNamedCandidateCodeUnits, 32);
  assert.equal(unit.metrics.namedLookups, 32);
  assert.ok(unit.metrics.namedLookupComparisons <= 32 * 12);
});

void test("direct incremental consumer returns stable completion", () => {
  const guard = createEngineResourceGuard();
  const cursor = new HtmlInputCursor(guard);
  cursor.write("&");
  const ampersand = cursor.consume();
  assert.equal(ampersand.kind, "character");
  const consumer = new CharacterReferenceConsumer(cursor, guard, {
    context: "text",
    ampersandSpan: { startUtf16Offset: 0, endUtf16Offset: 1 }
  });
  assert.deepEqual(consumer.step(), {
    kind: "need-more-input",
    consumedUtf16: 0,
    position: { utf16Offset: 1 }
  });
  cursor.write("amp");
  assert.equal(consumer.step().kind, "need-more-input");
  cursor.write(";");
  const completed = consumer.step();
  assert.equal(completed.kind, "resolved");
  assert.equal(completed.value, "&");
  assert.equal(consumer.step(), completed);
});
