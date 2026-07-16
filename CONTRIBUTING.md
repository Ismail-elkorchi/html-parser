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

The html5lib conformance corpus is a submodule. Initialize it once per checkout:

```bash
git submodule update --init --recursive
```

For release-level audits:
- `npm run eval:release`

## Naming policy
- Use domain-first names and explicit reference frames.
- Use truth-conditional booleans (`is*`, `has*`, `can*`).
- Use stable, domain-first log phrasing for grep-friendly diagnostics.

## Maintainer docs

- [Maintainer index](./docs/maintainers/index.md)
