# ADR-005: Add Playwright for multi-engine browser differential oracle

- Status: accepted
- Date: 2026-02-15

## Context
Release evaluation requires a real browser differential oracle with Chromium, Firefox, and WebKit.
The previous implementation relied on non-browser fallback behavior and could not validate true multi-engine agreement.

## Decision
- Add `playwright@1.58.2` as a dev dependency.
- Implement `scripts/oracles/run-browser-diff.mjs` using headless Chromium, Firefox, and WebKit.
- Keep oracle execution out of pull-request CI and run it in a dedicated scheduled/manual workflow.

## Alternatives considered
- Keep fallback `DOMParser`-like normalization in Node (insufficient oracle fidelity).
- Add per-engine custom harnesses without Playwright (higher integration complexity and maintenance burden).

## Consequences
- Higher confidence in release oracle coverage across major browser engines.
- Added supply-chain surface and CI/runtime cost due to browser binaries.

## Validation plan
- `npm run test:browser-diff` executes real engine runs when browsers are installed.
- `npm run eval:release` enforces browser-diff gates with strict engine presence and agreement thresholds.
- `.github/workflows/oracle.yml` runs the release profile on schedule/manual dispatch.

## Rollback plan
- If Playwright cost exceeds acceptable limits, replace with an equivalent multi-engine runner that preserves oracle coverage and report shape.
- Remove `playwright` from `devDependencies`, drop oracle workflow references, and supersede this ADR.

## Links
- docs/debt.md
