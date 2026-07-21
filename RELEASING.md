# Releasing

## Publish model

Publishing is performed via GitHub Actions OIDC (tokenless):

- npm Trusted Publishing
- JSR OIDC publishing

Publication has one route: publish a GitHub release whose tag is exactly
`v<package.json version>`. The tag, release event SHA, checked-out commit, and
current `main` commit must all be identical. The publish workflow reruns the
complete release qualification on that checkout before either registry is
written. It preserves the exact npm tarball installed by package qualification,
publishes that artifact, and verifies npm integrity/provenance and the complete
JSR file manifest after publication. Registry writes are idempotent only when
an existing version is byte-for-byte identical, so a partially completed run
can be safely retried. There is no manual branch, tag, or arbitrary-SHA
publishing path.

Release builds use the npm version declared by `packageManager` and a pinned
Deno runtime for native JSR publication on GitHub-hosted runners. The npm
trusted publisher must identify
`Ismail-elkorchi/html-parser`, `publish.yml`, and the `npm publish` action; the
JSR package must remain linked to the same GitHub repository. Both registries
use OIDC and require `id-token: write`.

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
