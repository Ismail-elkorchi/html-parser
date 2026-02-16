# Releasing (alpha policy)

Release execution is tag-based (`v*`) in `.github/workflows/release.yml`.
The workflow runs `eval:release` before publish steps.

## Package identity

- Intended public npm package name: `@ismail-elkorchi/html-parser`
- Intended public JSR package name: `@ismail-elkorchi/html-parser`
- Versioning policy: `0.x` until parser/evaluation hardening exits alpha posture.

## Local release verification

Run from a clean `main` checkout:

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm test
npm run eval:ci
npm run eval:release
```

Required release evidence:
- `reports/check-gates.json` is `ok: true` for release profile.
- `reports/runtime-self-contained.json` is `ok: true`.
- `reports/no-external-imports.json` is `ok: true`.
- `reports/browser-diff.json` includes chromium/firefox/webkit and meets configured agreement threshold.

## JSR prerequisites

JSR publishing in GitHub Actions is tokenless and uses OIDC (`id-token: write`).

Before tag-based publishing:
1. Link the JSR package to this GitHub repository in JSR settings.
2. Confirm the release workflow identity is allowed by JSR for OIDC publish.
3. Keep `jsr.json` package identity aligned with repository release identity.

Release workflow JSR publish command:

```bash
npx jsr publish
```

## npm prerequisites

Target release posture is npm Trusted Publishing (OIDC).

Before enabling tag-based npm publish:
1. Configure the npm package settings to trust this repository release workflow.
2. Validate OIDC trusted publishing for tag-triggered releases.
3. Confirm package visibility and access policy (`public`) in npm settings.

With npm Trusted Publishing, provenance attestations are emitted automatically.

## Tagging

Create and push an annotated tag after all release checks pass:

```bash
git switch main
git pull --ff-only
git tag -a v0.x.y -m "v0.x.y"
git push origin v0.x.y
```

## Manual fallback publishing

If trusted publishing is not yet enabled, publication can be run manually after explicit approval:
- npm: `npm publish --access public`
- JSR: `npx jsr publish`

`package.json` and `jsr.json` must stay aligned with intended public identity and tagged versioning policy.

## Third-party notices checklist

Before publishing, confirm `THIRD_PARTY_NOTICES.md` includes:
- vendored parser runtime source (`src/internal/vendor/parse5`)
- vendored entity decoder source (`src/internal/vendor/entities`)
- vendored entities dataset (`vendor/whatwg/entities.json`)
- vendored conformance dataset (`vendor/html5lib-tests`)

Publishing is blocked if notices are incomplete.
