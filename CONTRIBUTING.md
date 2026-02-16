# Contributing

## Workflow
- Repository changes are pull-request only.
- Do not commit directly to the default branch.
- Use short-lived topic branches and keep scope reviewable.
- Preferred merge strategy is squash merge with branch deletion.

## Local verification
Run before opening a pull request:
- `npm install` (or `npm ci` when a lockfile exists)
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run eval:ci`

For release-level audits:
- `npm run eval:release`

## Naming policy
- Follow `docs/naming-conventions.md`.
- Use domain-first names and explicit reference frames.
- Use truth-conditional booleans (`is*`, `has*`, `can*`).
- Use stable log labels (`CUE:`, `ACT:`, `EVAL:`) for grep-friendly diagnostics.

## ADR discipline
Create or update an ADR in `docs/decisions/` when changing policy-sensitive behavior:
- ADR-001 for fixture skips
- ADR-002 for gate or threshold changes
- ADR-003 for oracle or normalization rules
- ADR-004 for dataset updates
- ADR-005 for dev dependency additions

Every PR that touches one of these areas must link the ADR in its body.
