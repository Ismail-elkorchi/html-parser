# ADR-012: Browser differential oracle runs multi-engine via Playwright

- Status: accepted
- Date: 2026-02-16
- Supersedes: docs/decisions/ADR-003-browser-diff-normalization-v1.md

## Context
ADR-003 documented a transitional fallback model that allowed non-browser normalization when real engines were unavailable. The active release oracle now runs real browser engines and records per-engine evidence.

## Decision
- Browser differential execution is implemented with Playwright and requires three engines:
  - `chromium`
  - `firefox`
  - `webkit`
- Oracle execution is part of release evaluation evidence and scheduled/manual oracle workflow execution.
- Report artifacts under `reports/browser-diff.json` include:
  - deterministic corpus metadata (`name`, `seed`, `cases`)
  - per-engine `compared`, `agreed`, `disagreed`
  - engine `version` and `userAgent` when launch succeeds
  - disagreement records with triage paths
- Chromium-only fallback is not accepted as release oracle evidence.

## Alternatives considered
- Retain fallback normalization in non-browser environments (rejected: insufficient oracle fidelity).
- Run single-engine differential only (rejected: does not meet multi-engine release requirement).

## Consequences
- Release evaluation is tied to real browser behavior across major engines.
- Oracle runs have higher execution cost but stronger interoperability evidence.

## Validation plan
- `npm run test:browser-diff`
- `npm run eval:release`
- Confirm `reports/browser-diff.json` includes all required engines.

## Rollback plan
- If engine execution changes are required, introduce a superseding ADR that preserves multi-engine fidelity requirements.
