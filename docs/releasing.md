# Releasing

## Trigger
- Push a tag matching `v*`, or run the `Release` workflow manually.

## Release workflow
Workflow file: `.github/workflows/release.yml`

Pipeline:
1. checkout (with submodules)
2. install Node, Deno, and Bun toolchains
3. `npm ci`
4. `npm run build`
5. `npm run eval:release`
6. optional publish steps when secrets are configured:
   - npm: `NPM_TOKEN`
   - JSR: `JSR_TOKEN`

## Local preflight
Run before creating a release tag:
- `npm run lint`
- `npm run typecheck`
- `npm run eval:release`

## Notes
- Runtime dependencies must remain empty.
- Release evaluation requires deterministic reports under `reports/`.
