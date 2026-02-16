# ADR-002: Parse error taxonomy gate

Status: Accepted  
Date: 2026-02-16

## Context

Agent consumers need a stable parser-error identifier to classify failures and link diagnostics to specification context.
Without an enforced gate, parse-error fields can drift, become undocumented, or disappear from the public API and reports.

## Decision

- Expose `parseErrorId` on parser-reported public errors.
- Expose `getParseErrorSpecRef(parseErrorId)` as the public spec-reference helper.
- Add required gate `G-088`:
  - API export exists.
  - Parser errors include deterministic `parseErrorId` values.
  - Helper returns the stable WHATWG parse-errors section URL.
  - `docs/parse-errors.md` exists.
  - `test/control/parse-errors.test.js` exists.
  - Agent report includes `features.parseErrorId.ok=true`.

## Alternatives considered

- Keep parser error taxonomy internal and rely on freeform messages.
  - Rejected: unstable for automation and weak for reproducible triage.
- Use per-error deep links to individual parse-error rows.
  - Rejected: anchor stability is weaker than section-level links.

## Consequences

- Parse-error diagnostics become machine-readable and deterministic.
- Consumers can link parser diagnostics to a stable spec section without vendor-specific parsing logic.
- CI and release evaluation now fail if the taxonomy contract regresses.

## Validation plan

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run eval:ci`

## Rollback plan

- If taxonomy wiring causes a correctness regression, revert `G-088` and public `parseErrorId` exposure in one PR, then supersede this ADR with a corrected gate definition before re-enabling.
