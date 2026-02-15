# ADR-001: Skip fixture(s) <short description>

- Status: proposed | accepted | superseded
- Date: YYYY-MM-DD
- Suite: tokenizer | tree | encoding | serializer | holdout
- Scope: list exact fixture ids

## Context
- What fixture(s) are being skipped?
- Why is this skip needed?
- Is it because the fixture requires JS execution, or because of a harness limitation?

## Decision
- The exact skip rule:
  - include exact ids or deterministic selection rule
- The reason category:
  - REQUIRES_JS_EXECUTION
  - HARNESS_LIMITATION
  - UNSUPPORTED_V1 (must include a planned remediation)

## Consequences
- What correctness surface becomes untested because of this skip?

## Validation plan
- How will we verify the skip is not hiding regressions?
- What additional targeted tests are added?

## Rollback plan
- What work removes this skip?

## Links
- Fixture ids:
- Triage records:
