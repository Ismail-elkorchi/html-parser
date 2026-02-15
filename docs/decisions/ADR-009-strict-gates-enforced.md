# ADR-009: Enforce strict CI and release gates

- Status: accepted
- Date: 2026-02-15
- Supersedes: docs/decisions/ADR-002-staged-threshold-realignment.md

## Context
Conformance and oracle work reached strict pass criteria in active evaluation runs.
Staged relaxation in thresholds no longer reflects repository reality and leaves avoidable drift risk.

## Decision
- Enforce strict holdout conformance thresholds:
  - `thresholds.conformance.holdout.minPassRate = 1`
  - `thresholds.conformance.holdout.maxSkips = 0`
- Enforce Deno/Bun smoke requirements in CI profile:
  - `profiles.ci.requireDeno = true`
  - `profiles.ci.requireBun = true`
- Enforce `npm run eval:ci` directly in CI node job.

## Consequences
- CI now fails immediately when gate regressions appear in conformance, smoke, or policy checks.
- Release profile remains stricter than CI by requiring holdout and browser differential oracle checks.

## Validation plan
- `npm run eval:ci`
- `npm run eval:release`
- CI node workflow includes `npm run eval:ci`

## Rollback plan
- If strict enforcement blocks critical work unexpectedly, introduce a narrowly scoped superseding ADR with explicit sunset criteria and measurable exit conditions.
