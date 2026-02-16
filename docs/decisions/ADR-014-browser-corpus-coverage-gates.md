# ADR-014: Browser differential corpus coverage thresholds

- Status: accepted
- Date: 2026-02-16
- Supersedes: none (extends docs/decisions/ADR-012-browser-diff-multi-engine-playwright.md)

## Context
ADR-012 established multi-engine browser differential execution, but release evidence lacked minimum corpus breadth and category coverage requirements. A small corpus can satisfy agreement thresholds while missing high-risk HTML surfaces.

## Decision
- Browser differential runs use a versioned curated corpus file at `scripts/oracles/corpus/curated-v3.json` as the primary oracle input.
- Release thresholds add corpus coverage requirements:
  - `thresholds.browserDiff.minCases >= 500`
  - `thresholds.browserDiff.minTagCoverage >= 10` for each configured required tag.
- Browser differential reports include:
  - `corpus.totalCases`, `corpus.curatedCases`, `corpus.randomCases`, `corpus.seed`
  - `coverage.tagCounts` and `coverage.minPerTag`
- Browser differential execution fails only when configured browser thresholds are not met.
- Disagreement entries remain deterministic through stable case IDs.

## Alternatives considered
- Keep small corpus and rely on agreement threshold only (rejected: insufficient coverage guarantees).
- Enforce coverage in CI profile (rejected: browser-diff remains release-profile evidence to preserve CI latency).

## Consequences
- Release evidence becomes harder to satisfy with narrow oracle inputs.
- Corpus and tag coverage become auditable and deterministic.

## Validation plan
- `npm run test:browser-diff`
- `npm run eval:release`
- Confirm `reports/browser-diff.json` includes `corpus` and `coverage` fields with thresholds satisfied.

## Rollback plan
- Any relaxation of browser corpus thresholds requires a superseding ADR with explicit risk assessment.
