# ADR-002: Hermetic evaluation and profile-weighted scoring

Status: Accepted  
Date: 2026-02-16

## Context

Evaluation artifacts are generated under `reports/` and are not committed.
Without explicit cleanup, stale report files can leak into later runs and distort score output.
CI and release profiles also evaluate different evidence surfaces, so a single shared score weight set can award points for reports that CI does not execute.

## Decision

- Add `scripts/eval/clean-reports.mjs` and run it as the first step of `scripts/eval/run-eval.mjs`.
- Delete all `reports/*` artifacts except `reports/.gitkeep` at the start of each evaluation run.
- Support profile-specific score weights in `evaluation.config.json`:
  - `profiles.ci.weights`
  - `profiles.release.weights`
- Require each profile weight set to sum to exactly `100`.
- Update `scripts/eval/score.mjs` to use profile weights when present and include `weightsUsed` in `reports/score.json`.
- Define zero-weight behavior: if a score component weight is `0`, that component score does not depend on report presence.

## Alternatives considered

- Keep existing global weights and infer profile relevance from report presence.
  - Rejected: stale artifacts can still leak into score output.
- Keep non-hermetic report directory and rely on CI workspace isolation.
  - Rejected: local evaluation reproducibility must match CI behavior.

## Consequences

- `npm run eval:ci` and `npm run eval:release` become hermetic and reproducible from a clean report surface.
- CI scoring no longer awards release-only surfaces by accident.
- Score outputs now explicitly document the applied weight source.

## Validation plan

- `npm ci`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run eval:ci`
- `npm run eval:release`

## Rollback plan

- Revert `clean-reports` wiring and profile-weighted score logic in one PR if a critical regression appears, then re-introduce with corrected compatibility guards.
