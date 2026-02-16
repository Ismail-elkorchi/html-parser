# ADR-013: Strict threshold posture is the default and enforced

- Status: accepted
- Date: 2026-02-16
- Supersedes:
  - docs/decisions/ADR-002-staged-threshold-realignment.md
  - docs/decisions/ADR-009-strict-gates-enforced.md

## Context
The staged threshold posture in ADR-002 is obsolete. Strict conformance and release policies are active and enforced through current gate checks and evaluation profiles.

## Decision
- Conformance thresholds remain strict:
  - tokenizer/tree/encoding/serializer/holdout use `minPassRate = 1` and `maxSkips = 0`.
- Browser differential release thresholds remain strict:
  - `minEnginesPresent = 3`
  - `minAgreement >= 0.999`
- CI profile remains strict on required runtime evidence:
  - Deno and Bun smoke checks are required.
- Gate definitions in `docs/acceptance-gates.md` and `evaluation.config.json` are the normative source of threshold enforcement.

## Alternatives considered
- Reintroduce staged threshold relaxation (rejected: reduces correctness signal and delays regression detection).
- Make release profile optional in operational docs (rejected: weakens readiness definition).

## Consequences
- Evaluation posture remains stable and strict across CI and release profiles.
- Threshold changes require new ADRs and explicit evidence.

## Validation plan
- `npm run eval:ci`
- `npm run eval:release`
- Confirm gate reports and thresholds align with `evaluation.config.json`.

## Rollback plan
- Any future threshold relaxation requires a superseding ADR with explicit sunset criteria and measurable exit conditions.
