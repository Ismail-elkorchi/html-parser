# ADR-017: Naming policy doc required by docs gate

Status: Accepted  
Date: 2026-02-16

## Context

Identifier naming quality directly affects parser maintenance, gate diagnostics, and review reliability.
The repository previously had no required document that defined naming semantics for:
- domain-first identifiers
- truth-conditional booleans
- stable grep labels for evaluation logs

Without a required naming policy document, naming quality drifts across scripts and runtime modules.

## Decision

- Add `docs/naming-conventions.md` as a required repository document.
- Extend the docs gate (`G-120`) to require `docs/naming-conventions.md`.
- Keep the policy focused on deterministic engineering semantics:
  - ontology-first casing rules
  - cue/action/evaluation naming arc
  - explicit frame-of-reference terms
  - stable, domain-specific log messages without tag prefixes

## Alternatives considered

- Keep naming guidance informal in code review comments only.
  - Rejected: non-deterministic and not machine-checkable.
- Add lint-level identifier regex enforcement for all modules.
  - Rejected for now: high migration noise and third-party/vendor interaction risk.

## Consequences

- Documentation hygiene checks now enforce presence of naming policy.
- Contributors have a single canonical naming reference.
- Evaluation and oracle script identifiers become easier to grep and audit.

## Validation plan

- Run `npm run lint`.
- Run `npm run eval:ci` and confirm `reports/docs.json` remains `ok: true`.
- Confirm `docs/acceptance-gates.md` and docs gate script both list `docs/naming-conventions.md`.

## Rollback plan

- If the docs gate blocks valid workflows, remove `docs/naming-conventions.md` from required files in a superseding ADR-002 record.
- Preserve the document itself even if gate requirement is reverted.
