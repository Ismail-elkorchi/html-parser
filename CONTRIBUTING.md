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
- Use domain-first names and explicit reference frames.
- Use truth-conditional booleans (`is*`, `has*`, `can*`).
- Use stable, domain-first log phrasing for grep-friendly diagnostics.

## ADR discipline
Record major contributor-policy decisions in pull requests and keep rationale near the changed code:
- ADR-001 for fixture skips
- ADR-002 for gate or threshold changes
- ADR-003 for oracle or normalization rules
- ADR-004 for dataset updates
- ADR-005 for dev dependency additions

Every PR that touches one of these areas must link the ADR in its body.

## Maintainer docs

- [Maintainer index](./docs/maintainers/index.md)
