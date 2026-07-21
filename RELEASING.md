# Releasing

## Publish model

Publishing is performed via GitHub Actions OIDC (tokenless):

- npm Trusted Publishing
- JSR OIDC publishing

Publication has one route: publish a GitHub release whose tag is exactly
`v<package.json version>`. The tag, release event SHA, checked-out commit, and
current `main` commit must all be identical. The publish workflow reruns the
complete release qualification on that checkout before either registry is
written. There is no manual branch, tag, or arbitrary-SHA publishing path.

Use the manually dispatchable release-audit workflow for registry dry runs.
It never publishes.

## Required checks before publish

```bash
npm ci
npm run qualification:release
```

The release profile includes the fast checks, documentation tests,
conformance suites, artifact checks, and extended qualification gates.
Publishing repeats that profile after installing all three browser engines and
records the exact qualified commit with the package manifests.

## Release notes and changelog

```bash
npm run release:notes:dry-run
npm run changelog:update:dry-run
```

For test scope and corpus constraints, see `docs/maintainers/testing.md`.
