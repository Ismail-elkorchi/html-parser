# ADR-002: Smoke report must be authoritative runtime evidence

Status: Accepted  
Date: 2026-02-16

## Context

The previous smoke report was synthesized from runtime version detection in `write-stub-reports`.
That design could report success without binding evidence to actual smoke execution outcomes.

## Decision

- Make runtime smoke commands write per-runtime evidence artifacts directly:
  - `reports/smoke-node.json`
  - `reports/smoke-deno.json`
  - `reports/smoke-bun.json`
- Add `scripts/eval/collect-smoke-report.mjs` to aggregate runtime artifacts into:
  - `reports/smoke.json`
- Remove smoke report writing from `scripts/eval/write-stub-reports.mjs`.
- Keep gate `G-100` unchanged in strictness, but make its evidence authoritative by sourcing from executed smoke runs.

## Alternatives considered

- Keep smoke evidence in `write-stub-reports` and annotate as informational.
  - Rejected: gate evidence must reflect executed checks, not inferred runtime metadata.
- Replace smoke checks with version probes only.
  - Rejected: this weakens correctness and portability evidence.

## Consequences

- `reports/smoke.json` now reflects actual runtime executions.
- Failed runtime smoke checks produce `ok=false` evidence for the affected runtime while still preserving aggregated visibility.
- Evaluation diagnostics become more reliable for CI and release triage.

## Validation plan

- `npm ci`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run eval:ci`
- `npm run eval:release`

## Rollback plan

- Revert runtime smoke artifact wiring and collector integration in one PR if a critical regression appears, then reintroduce with corrected evidence flow.
