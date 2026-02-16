# ADR-002: Agent report stream-token coverage requirement

- Status: accepted
- Date: 2026-02-16

## Context
The evaluation report for agent features validated trace, spans, patch planning, outline, and chunk behavior, but it did not verify streamed tokenization behavior. This left a gap between documented streaming capability and evaluated agent-facing evidence.

## Decision
- Extend `reports/agent.json.features` with `streamToken`.
- Require `streamToken` checks to validate:
  - deterministic token sequence for a controlled chunked input;
  - structured, deterministic budget failure behavior for streamed tokenization.
- Keep gate `G-086` tied to `overall.ok`, so the new stream-token check is mandatory whenever agent report validation runs.
- Update report and gate documentation to include `streamToken`.

## Alternatives considered
- Keep stream-token checks outside the agent report in ad hoc tests only.
- Add a separate gate for stream tokenization.

## Consequences
- Agent report coverage now includes token-stream observability, not only tree-level and patch-level behavior.
- Regressions in streamed token determinism or budget failure paths are caught in CI through existing gate wiring.

## Validation plan
- Run `npm run eval:ci` and confirm:
  - `reports/agent.json.features.streamToken.ok` is `true`
  - `reports/agent.json.overall.ok` remains `true`
  - `reports/gates.json` gate `G-086` passes.

## Rollback plan
- If stream-token assertions produce false failures, add a superseding ADR that narrows only the failing check and keeps streamed token determinism and budget-failure validation mandatory.
