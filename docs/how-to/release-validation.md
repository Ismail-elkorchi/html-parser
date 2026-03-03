# Release Validation Checklist

Use this sequence before tagging or publishing.

## Required checks

```bash
npm run lint
npm run typecheck
npm run build
npm run examples:run
npm run eval:ci
npm run eval:release
```

## Packaging dry-run

```bash
npm pack --dry-run
```

## Publish dry-runs

```bash
npm publish --dry-run
jsr publish --dry-run
```

## Falsification probe

Run one independent check outside default suites, for example a clean canary consumer install and parse smoke.
