# ADR-003: Browser differential normalization strategy (v1)

- Status: accepted
- Date: 2026-02-15

## Context
Release profile requires a browser differential report. The project currently runs this oracle in a Node-driven workflow without a guaranteed embedded browser engine in every environment.

## Decision
- Use a deterministic normalization pipeline for browser differential inputs:
  - local normalization: `JSON.stringify(parse(input))`
  - browser-like normalization: `DOMParser` when available, otherwise deterministic local fallback
- Record results under engine key `chromium` in `reports/browser-diff.json`.
- Persist disagreement triage records under `docs/triage/` when normalization diverges.

## Alternatives considered
- Requiring Playwright immediately (adds substantial dev toolchain cost).
- Deferring browser differential entirely (breaks release gate requirements).

## Consequences
- Differential reporting remains deterministic and always available in CI-like environments.
- External browser parity depth is limited in environments without DOMParser.
- Migration to multi-engine browser execution remains a planned enhancement.

## Validation plan
- Run `npm run test:browser-diff` and confirm report generation.
- Ensure `node scripts/eval/check-gates.mjs --profile=release` accepts the generated report.

## Rollback plan
- Replace fallback oracle with strict multi-engine browser execution once toolchain debt is accepted and recorded.
