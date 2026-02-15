# ADR-002: Runtime self-containment and holdout discipline gates

- Status: accepted
- Date: 2026-02-15
- Supersedes: docs/decisions/ADR-002-staged-threshold-realignment.md

## Context
The previous zero-runtime-dependency gate only inspected `package.json`. It did not prove that the packed artifact runs without dev dependencies or that compiled output avoids external package imports.

Conformance reports also needed an explicit holdout-discipline invariant to detect accidental fixture-surface drift.

## Decision
- Strengthen runtime dependency enforcement with two required gates:
  - `G-012`: `reports/no-external-imports.json` must confirm no bare external imports in `dist/`.
  - `G-015`: `reports/runtime-self-contained.json` must confirm production-only tarball install and runtime smoke success.
- Keep `G-010` as a package manifest policy gate (`dependencies` must be empty).
- Require holdout discipline metadata in tokenizer/tree/encoding/serializer reports:
  - `holdoutExcluded`
  - `holdoutRule`
  - `holdoutMod`
- Enforce holdout fraction bounds in conformance gates:
  - `holdoutExcludedFraction` must be within `[0.05, 0.15]`.

## Alternatives considered
- Relying only on manifest inspection (`dependencies`) without runtime tarball execution.
- Relying only on conformance totals without explicit holdout metadata and fraction bounds.

## Consequences
- Gate compliance now reflects install and runtime reality, not manifest intent only.
- Dist artifacts cannot pass if they reference undeclared runtime packages.
- Conformance gates fail when executed fixture surface drifts outside documented holdout selection behavior.

## Validation plan
- `npm run eval:ci`
- Confirm reports exist and pass:
  - `reports/no-external-imports.json`
  - `reports/runtime-self-contained.json`
  - `reports/tokenizer.json`
  - `reports/tree.json`
  - `reports/encoding.json`
  - `reports/serializer.json`

## Rollback plan
- If a false positive is confirmed, add a superseding ADR that narrows only the failing rule with reproducible evidence and keeps runtime self-containment guarantees intact.
