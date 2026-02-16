# ADR-020: Doc policy coherence gate for naming and log labels

Status: Accepted  
Date: 2026-02-16

## Context

Repository policy documents had contradictory guidance for log labels:
- `CONTRIBUTING.md` allowed uppercase tag prefixes.
- `docs/naming-conventions.md` rejected synthetic uppercase tag prefixes.

Contradictory policy docs create drift for contributors and automation checks.

## Decision

- Define one canonical log label policy statement in `docs/naming-conventions.md` with a machine-checkable marker:
  - `LOG_LABEL_POLICY=DOMAIN_PHRASES_NO_TAG_PREFIX`
- Require `CONTRIBUTING.md` to reference the canonical marker instead of restating alternate rules.
- Add `scripts/eval/check-doc-policy.mjs` and gate `G-126` so CI and release fail on policy contradictions.

## Alternatives considered

- Keep policy alignment as a code review convention only.
  - Rejected: non-deterministic and easy to bypass with wording drift.
- Keep both docs as independent policy sources.
  - Rejected: ambiguous authority and inconsistent contributor behavior.

## Consequences

- Policy authority is explicit and machine-checkable.
- Contradictory edits in `CONTRIBUTING.md` are blocked by evaluation gates.
- Log diagnostics remain grep-friendly without synthetic tag-prefix markers.

## Validation plan

- `npm run eval:ci`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Rollback plan

- If the marker model proves too rigid, supersede this ADR with a replacement that keeps one canonical policy source and deterministic checks.
