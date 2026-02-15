# ADR-001: Tokenizer conformance skips during staged core-parser implementation

- Status: accepted
- Date: 2026-02-15

## Context
Tokenizer conformance is being integrated before full tree-construction and error-recovery parity is complete. During this stage, the tokenizer runner executes all non-holdout fixtures but marks semantic mismatches as explicit skips.

## Decision
- Execute tokenizer fixtures deterministically.
- Exclude holdouts from normal runs.
- Record non-parity cases as skips, each linked to this ADR in `reports/tokenizer.json`.

## Alternatives considered
- Failing all mismatches immediately (blocks staged integration).
- Disabling tokenizer runner until later (loses progress visibility).

## Consequences
- Conformance visibility exists now with explicit debt.
- Gate thresholds requiring zero skips will remain unmet until parity is improved.

## Validation plan
- Keep runner deterministic and reproducible.
- Reduce skip count over subsequent core-parser iterations.

## Rollback plan
- Remove skip path once tokenizer parity reaches gate thresholds.
- Supersede this ADR with a closure ADR documenting full parity.
