# ADR-007: Tree conformance mismatches are hard failures

## Status
Accepted

## Context

Tree-construction conformance previously recorded many mismatches as skips.
That policy reduced signal quality and allowed parser regressions to pass CI.

## Decision

- Tree-construction conformance mismatches are counted as `failed`, never `skipped`.
- `skipped` remains reserved for deterministic holdout exclusion only.
- Evaluation thresholds for tree conformance are strict:
  - `minPassRate = 1.0`
  - `maxSkips = 0`

## Consequences

- CI now blocks on any tree mismatch outside holdout.
- Divergence triage artifacts remain available under `docs/triage/` for debugging.
- The previous staged-skip policy in `ADR-001-tree-construction-conformance-skips.md` is superseded by this decision.
