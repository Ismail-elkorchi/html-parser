# ADR-001: Serializer conformance skips during staged deterministic serializer implementation

- Status: accepted
- Date: 2026-02-15

## Context
The serializer baseline is deterministic and stable, but not all html5lib serializer options and namespace edge cases are implemented yet.

## Decision
- Execute non-holdout serializer fixtures.
- Record mismatches as skips linked to this ADR.

## Alternatives considered
- Hard-failing all mismatches (blocks progressive integration).
- Deferring serializer runner entirely (loss of visibility).

## Consequences
- Progress is measurable with explicit conformance debt.
- Zero-skip thresholds remain unmet until parity is complete.

## Validation plan
- Maintain deterministic output.
- Reduce skips over successive increments.

## Rollback plan
- Remove skip handling once serializer parity is achieved.
- Supersede this ADR with closure documentation.
