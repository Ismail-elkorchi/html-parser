# Releasing (alpha policy)

This repository does not publish automatically.
Release execution is manual and only occurs after `eval:release` passes.

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

## Tagging

Create and push an annotated tag after all release checks pass:

```bash
git switch main
git pull --ff-only
git tag -a v0.x.y -m "v0.x.y"
git push origin v0.x.y
```

## npm publish steps (manual)

When publication is explicitly approved:

1. Set `package.json`:
   - `private: false`
   - `name: @ismail-elkorchi/html-parser`
2. Regenerate build and run the full release verification commands.
3. Publish:

```bash
npm publish --access public
```

## JSR publish steps (manual)

When publication is explicitly approved:

```bash
npx jsr publish
```

`jsr.json` must stay aligned with intended public identity and the tagged version line.

## Third-party notices checklist

Before publishing, confirm `THIRD_PARTY_NOTICES.md` includes:
- vendored parser runtime source (`src/internal/vendor/parse5`)
- vendored entity decoder source (`src/internal/vendor/entities`)
- vendored entities dataset (`vendor/whatwg/entities.json`)
- vendored conformance dataset (`vendor/html5lib-tests`)

Publishing is blocked if notices are incomplete.
