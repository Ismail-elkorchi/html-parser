# ADR-006: Tokenizer mismatches are hard failures

- Status: accepted
- Date: 2026-02-15

## Context
Tokenizer conformance was previously tracked with mismatch-to-skip accounting. This hid real correctness gaps in routine suite execution.

## Decision
- In tokenizer conformance:
  - holdout exclusion remains deterministic and unchanged.
  - any non-holdout output mismatch is counted as `failed`.
  - mismatches are not counted as `skipped`.
- The tokenizer conformance gate must enforce:
  - `minPassRate = 1.0`
  - `maxSkips = 0`

## Alternatives considered
- Continue mismatch-to-skip accounting (reject: masks regressions).
- Expand holdout to absorb mismatches (reject: violates holdout discipline).

## Consequences
- Tokenizer regressions fail fast in local and CI evaluation.
- Remaining correctness gaps must be fixed in implementation, not policy.

## Validation plan
- Run `npm run test:conformance`.
- Confirm `reports/tokenizer.json` has `failed=0` and `skipped=0`.
- Run `npm run eval:ci`.

## Rollback plan
- Revert only if the tokenizer runner itself is incorrect, then restore this policy once fixed.
