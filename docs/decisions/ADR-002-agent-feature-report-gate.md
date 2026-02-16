# ADR-002: Agent feature report gate enforcement

- Status: accepted
- Date: 2026-02-16

## Context
The evaluation stack scored agent-first features from `reports/agent.json`, but gate enforcement did not require a non-stub agent report in either CI or release profiles. This allowed an evaluation run to remain green even when agent-facing capabilities were not validated as a required acceptance condition.

## Decision
- Add `G-086` to require an agent feature report in CI and release profiles.
- Require `reports/agent.json` with `overall.ok=true`.
- Require deterministic, bounded checks for:
  - `trace`
  - `spans`
  - `patch`
  - `outline`
  - `chunk`
- Generate `reports/agent.json` explicitly during evaluation via `scripts/eval/write-agent-report.mjs`.
- Mark profile policy with `requireAgentReport=true` for both `ci` and `release`.

## Alternatives considered
- Keep agent scoring as advisory and do not gate it.
- Gate only report existence and not `overall.ok`.

## Consequences
- Agent-facing regressions become hard failures instead of score-only degradation.
- CI and release evaluations share the same minimum agent-feature validation contract.
- Report schema becomes a stable interface for downstream scoring and audit scripts.

## Validation plan
- Run `npm run eval:ci` and verify:
  - `reports/agent.json` exists
  - `reports/agent.json.overall.ok` is `true`
  - `reports/gates.json` includes `G-086` with `pass=true`
- Run `npm run eval:release` when changing agent or oracle behavior.

## Rollback plan
- If `G-086` produces a false failure, add a superseding ADR that narrows only the invalid assertion while preserving deterministic agent-feature enforcement.
