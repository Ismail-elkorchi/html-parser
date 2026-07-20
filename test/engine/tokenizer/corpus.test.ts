import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  compareEngineTokenizerFixture,
  loadEngineTokenizerFixtures,
  runEngineTokenizerFixture,
  type EngineTokenizerFixtureOutcome
} from "../../support/engine-tokenizer-fixtures.js";

function semanticOutcome(outcome: EngineTokenizerFixtureOutcome): unknown {
  return {
    tokens: outcome.tokens,
    errors: outcome.errors.map(({ code, phase, span }) => ({ code, phase, span }))
  };
}

function codeUnitChunks(input: string): readonly string[] {
  return Array.from({ length: input.length }, (_, index) => input.slice(index, index + 1));
}

function scalarChunks(input: string): readonly string[] {
  return Array.from(input);
}

function delimiterChunks(input: string): readonly string[] {
  const chunks: string[] = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (!"&<>/?-]'\"\r\0".includes(input.charAt(index))) continue;
    if (start < index) chunks.push(input.slice(start, index));
    chunks.push(input.slice(index, index + 1));
    start = index + 1;
  }
  if (start < input.length) chunks.push(input.slice(start));
  return chunks;
}

function deterministicChunks(input: string, id: string): readonly string[] {
  let state = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    state = Math.imul(state ^ id.charCodeAt(index), 0x01000193) >>> 0;
  }
  const chunks: string[] = [];
  let offset = 0;
  while (offset < input.length) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const width = 1 + ((state >>> 0) % 11);
    chunks.push(input.slice(offset, offset + width));
    offset += width;
  }
  return chunks;
}

function emptyInterleavedChunks(input: string): readonly string[] {
  const chunks: string[] = [""];
  for (const chunk of scalarChunks(input)) chunks.push(chunk, "");
  return chunks;
}

void test("the complete tokenizer matches every applicable fixture", () => {
  const fixtures = loadEngineTokenizerFixtures();
  assert.equal(fixtures.length, 7036);
  let passed = 0;
  const standardsDifferences = [];

  for (const fixture of fixtures) {
    const outcome = runEngineTokenizerFixture(fixture, [fixture.input]);
    const comparison = compareEngineTokenizerFixture(fixture, outcome);
    if (!comparison.matches) {
      assert.equal(
        comparison.recognizedStandardsDifference,
        true,
        `${fixture.id}: unexplained tokenizer corpus difference\n` +
          `actual tokens ${JSON.stringify(outcome.fixtureTokens)}\n` +
          `expected tokens ${JSON.stringify(fixture.expectedTokens)}\n` +
          `actual errors ${JSON.stringify(outcome.errors.map((error) => error.code))}\n` +
          `expected errors ${JSON.stringify(fixture.expectedErrorCodes)}`
      );
      assert.ok(comparison.difference);
      standardsDifferences.push(comparison.difference);
      continue;
    }
    passed += 1;
  }

  assert.equal(passed, 6998);
  assert.equal(standardsDifferences.length, 38);
  standardsDifferences.sort((left, right) => left.id.localeCompare(right.id));
  assert.equal(
    createHash("sha256").update(JSON.stringify(standardsDifferences)).digest("hex"),
    "3b931b821b41febec2667908f130d602699921a0f208c1d39bde0b99aa579a7c"
  );
});

void test("every tokenizer outcome is invariant across adversarial chunk schedules", () => {
  for (const fixture of loadEngineTokenizerFixtures()) {
    const whole = runEngineTokenizerFixture(fixture, [fixture.input]);
    const schedules = [
      codeUnitChunks(fixture.input),
      scalarChunks(fixture.input),
      delimiterChunks(fixture.input),
      deterministicChunks(fixture.input, fixture.id),
      emptyInterleavedChunks(fixture.input)
    ];
    for (const chunks of schedules) {
      const chunked = runEngineTokenizerFixture(fixture, chunks);
      assert.deepEqual(semanticOutcome(chunked), semanticOutcome(whole), fixture.id);
    }
  }
});
