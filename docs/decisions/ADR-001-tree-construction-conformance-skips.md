# ADR-001: Tree-construction conformance skips during staged insertion-mode implementation

- Status: accepted
- Date: 2026-02-15

## Context
The current tree builder includes deterministic baseline handling but does not yet implement full HTML insertion-mode, adoption agency, and foreign-content behavior required by the entire fixture corpus.

## Decision
- Execute non-holdout tree-construction fixtures deterministically.
- Record parity mismatches as skips linked to this ADR.
- Emit divergence records in `docs/triage/` for representative failures.

## Alternatives considered
- Hard-failing all mismatches (halts staged integration).
- Disabling tree fixture execution (removes visibility).

## Consequences
- Conformance debt is explicit and traceable.
- Gate thresholds requiring zero skips remain unmet until parity work completes.

## Validation plan
- Preserve deterministic runner behavior.
- Decrease skip count over successive core-parser increments.

## Rollback plan
- Remove skip policy once fixture parity is achieved.
- Supersede this ADR with closure documentation.
