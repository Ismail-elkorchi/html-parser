import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  loadEngineTokenizerFixtures,
  runEngineTokenizerFixture,
  type EngineTokenizerFixtureCase,
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

function errorCodes(outcome: EngineTokenizerFixtureOutcome): readonly string[] {
  return outcome.errors.map((error) => error.code);
}

function isKnownProcessingInstructionDrift(
  fixture: EngineTokenizerFixtureCase,
  outcome: EngineTokenizerFixtureOutcome
): boolean {
  return fixture.input.includes("<?") && (
    outcome.tokens.some((token) => token.kind === "processing-instruction") ||
    outcome.errors.some((error) => error.code.includes("processing-instruction"))
  );
}

void test("the complete tokenizer matches every applicable primary and holdout fixture", () => {
  const fixtures = loadEngineTokenizerFixtures();
  assert.equal(fixtures.length, 7036);
  const counts = {
    primaryPass: 0,
    primaryStandardDrift: 0,
    holdoutPass: 0,
    holdoutStandardDrift: 0
  };
  const standardDriftFingerprint = createHash("sha256");

  for (const fixture of fixtures) {
    const outcome = runEngineTokenizerFixture(fixture, [fixture.input]);
    const tokensMatch = JSON.stringify(outcome.fixtureTokens) === JSON.stringify(fixture.expectedTokens);
    const errorsMatch = fixture.expectedErrorCodes === null || fixture.doubleEscaped ||
      JSON.stringify(errorCodes(outcome)) === JSON.stringify(fixture.expectedErrorCodes);

    if (!tokensMatch || !errorsMatch) {
      assert.equal(
        isKnownProcessingInstructionDrift(fixture, outcome),
        true,
        `${fixture.id}: unexplained tokenizer corpus difference\n` +
          `actual tokens ${JSON.stringify(outcome.fixtureTokens)}\n` +
          `expected tokens ${JSON.stringify(fixture.expectedTokens)}\n` +
          `actual errors ${JSON.stringify(errorCodes(outcome))}\n` +
          `expected errors ${JSON.stringify(fixture.expectedErrorCodes)}`
      );
      if (fixture.holdout) counts.holdoutStandardDrift += 1;
      else counts.primaryStandardDrift += 1;
      standardDriftFingerprint.update(JSON.stringify({
        initialState: fixture.initialState,
        input: fixture.input,
        expectedTokens: fixture.expectedTokens,
        expectedErrors: fixture.expectedErrorCodes,
        actualTokens: outcome.fixtureTokens,
        actualErrors: errorCodes(outcome)
      }));
      continue;
    }

    if (fixture.holdout) counts.holdoutPass += 1;
    else counts.primaryPass += 1;
  }

  assert.deepEqual(counts, {
    primaryPass: 6297,
    primaryStandardDrift: 34,
    holdoutPass: 701,
    holdoutStandardDrift: 4
  });
  assert.equal(
    standardDriftFingerprint.digest("hex"),
    "8f9d963cf4de2ad4121e8f81aefb62ac137f185c8820ff07611626d0dd9861f0"
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
