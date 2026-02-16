# ADR-011: Conformance mismatches are failures across all suites

- Status: accepted
- Date: 2026-02-16
- Supersedes:
  - docs/decisions/ADR-001-tokenizer-conformance-skips.md
  - docs/decisions/ADR-001-tree-construction-conformance-skips.md
  - docs/decisions/ADR-001-serializer-conformance-skips.md
  - docs/decisions/ADR-001-encoding-malformed-meta-skips.md

## Context
Historical ADR-001 records described a staged skip posture where conformance mismatches were tracked as skip debt. The active conformance policy and gate behavior now require strict correctness for non-holdout cases.

## Decision
- For tokenizer, tree, encoding, serializer, and holdout conformance execution:
  - any non-holdout mismatch is a `failed` case.
  - mismatches are never converted to `skipped`.
- `skipped` remains reserved for explicit exclusion policy only and must reference an ADR when used.
- Holdout exclusion remains deterministic and reproducible using `hash(id) % 10 === 0`.

## Alternatives considered
- Continue mismatch-to-skip accounting (rejected: hides correctness regressions).
- Increase holdout or exclusion surface to avoid failures (rejected: reduces executed surface and gate signal).

## Consequences
- Conformance regressions fail immediately in local and CI runs.
- Reports provide direct failure accounting without skip-based debt masking.

## Validation plan
- `npm run test:conformance`
- `npm run test:holdout`
- `npm run eval:ci`

## Rollback plan
- If a runner defect is identified, fix the runner behavior without restoring mismatch-to-skip policy.
