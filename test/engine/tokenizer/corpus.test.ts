import assert from "node:assert/strict";
import test from "node:test";

import {
  loadEngineTokenizerFixtures,
  runEngineTokenizerFixture
} from "../../support/engine-tokenizer-fixtures.js";

function semanticOutcome(
  outcome: ReturnType<typeof runEngineTokenizerFixture>
): unknown {
  return {
    fixtureTokens: outcome.fixtureTokens,
    errors: outcome.errors.map(({ code, phase, span }) => ({ code, phase, span })),
    unsupportedState: outcome.unsupportedState
  };
}

void test("every IHP-04-applicable primary and holdout fixture matches", () => {
  const fixtures = loadEngineTokenizerFixtures();
  assert.equal(fixtures.length, 7036);
  const counts = {
    primaryPass: 0,
    primaryUnsupported: 0,
    holdoutPass: 0,
    holdoutUnsupported: 0
  };
  const unsupported = new Map<string, number>();

  for (const fixture of fixtures) {
    const outcome = runEngineTokenizerFixture(fixture, [fixture.input]);
    if (outcome.unsupportedState === null) {
      assert.deepEqual(outcome.fixtureTokens, fixture.expectedTokens, fixture.id);
      if (
        fixture.expectedErrorCodes !== null &&
        !fixture.doubleEscaped
      ) {
        assert.deepEqual(
          outcome.errors.map((error) => error.code),
          fixture.expectedErrorCodes,
          `${fixture.id} error order`
        );
      }
      if (fixture.holdout) counts.holdoutPass += 1;
      else counts.primaryPass += 1;
    } else {
      unsupported.set(
        outcome.unsupportedState,
        (unsupported.get(outcome.unsupportedState) ?? 0) + 1
      );
      if (fixture.holdout) counts.holdoutUnsupported += 1;
      else counts.primaryUnsupported += 1;
    }
  }

  assert.deepEqual(counts, {
    primaryPass: 6175,
    primaryUnsupported: 156,
    holdoutPass: 690,
    holdoutUnsupported: 15
  });
  assert.deepEqual(Object.fromEntries([...unsupported].sort()), {
    "cdata-section-state": 56,
    "processing-instruction-open-state": 38,
    "rawtext-less-than-sign-state": 19,
    "rcdata-less-than-sign-state": 20,
    "script-data-less-than-sign-state": 38
  });
});

void test("all IHP-04 outcomes are invariant under one-unit chunks", () => {
  for (const fixture of loadEngineTokenizerFixtures()) {
    const whole = runEngineTokenizerFixture(fixture, [fixture.input]);
    const units = Array.from({ length: fixture.input.length }, (_, index) =>
      fixture.input.slice(index, index + 1)
    );
    const chunked = runEngineTokenizerFixture(fixture, units);
    assert.deepEqual(semanticOutcome(chunked), semanticOutcome(whole), fixture.id);
  }
});
