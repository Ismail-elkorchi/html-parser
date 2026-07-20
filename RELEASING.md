# Releasing

## Publish model

Publishing is performed via GitHub Actions OIDC (tokenless):

- npm Trusted Publishing
- JSR OIDC publishing

Use `.github/workflows/publish.yml` for release-driven publishing and
`.github/workflows/publish-manual.yml` for manual dry runs or controlled
publishing.

## Required checks before publish

```bash
npm ci
npm run qualification:release
```

The release profile includes the fast checks, documentation tests,
conformance suites, artifact checks, and extended qualification gates.

## Release notes and changelog

```bash
npm run release:notes:dry-run
npm run changelog:update:dry-run
```

For test scope and corpus constraints, see `docs/maintainers/testing.md`.
