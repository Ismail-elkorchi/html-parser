# ADR-002: Span provenance and patch safety gate

Status: Accepted  
Date: 2026-02-16

## Context

Patch planning must avoid edits on parser-inferred nodes that do not map to stable source offsets.
Without explicit provenance, downstream tools can treat inferred nodes as patchable and produce unsafe rewrites.

## Decision

- Add `spanProvenance` to every parsed node:
  - `input`
  - `inferred`
  - `none`
- Require patch planning targets to have `spanProvenance: "input"`.
- Add structured patch error code:
  - `NON_INPUT_SPAN_PROVENANCE`
- Add gate `G-089` that enforces:
  - provenance field presence and allowed values
  - deterministic rejection of non-input span targets
  - documentation and tests for the contract
  - agent report spans/patch feature checks stay passing

## Alternatives considered

- Keep provenance implicit (`span` present/absent only).
  - Rejected: ambiguous for `captureSpans: false` and unclear for inferred wrappers.
- Allow patching inferred nodes with best-effort behavior.
  - Rejected: can silently corrupt output and breaks deterministic safety guarantees.

## Consequences

- Consumers can distinguish patch-safe vs non-patch-safe nodes without heuristics.
- Patch planning fails fast with structured diagnostics on unsafe targets.
- Evaluation and release gates now catch provenance regressions.

## Validation plan

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run eval:ci`

## Rollback plan

- If provenance integration regresses core behavior, revert this ADR’s code changes and `G-089` together, then supersede this ADR with a corrected provenance model.
