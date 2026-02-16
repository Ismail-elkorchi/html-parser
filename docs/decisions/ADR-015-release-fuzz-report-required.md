# ADR-015: Structured fuzz report is mandatory for release evaluation

- Status: accepted
- Date: 2026-02-16
- Supersedes: none

## Context
Release evaluation previously consumed fuzz evidence opportunistically. Absence of `reports/fuzz.json` did not fail release gates, which reduced robustness assurance. The fuzzer also lacked structured coverage of malformed HTML surfaces and did not expose slow-case diagnostics.

## Decision
- Fuzz generation is upgraded to a deterministic structured corpus generator covering:
  - nested elements
  - duplicate and irregular attribute patterns
  - comments and doctypes
  - foreign content (SVG/MathML)
  - templates
  - malformed and mismatched markup
- `reports/fuzz.json` now includes:
  - `outcomeDistribution` with normal parse and budget-error counts
  - `topSlowCases` with stable case IDs and seeds
- Release profile requires fuzz evidence:
  - `profiles.release.requireFuzzReport = true`
  - `thresholds.budgets.requireFuzzReport = true`
  - release gate `R-220` fails when `reports/fuzz.json` is missing or contains crashes/hangs.
- CI profile remains unchanged for latency control:
  - `profiles.ci.requireFuzzReport = false`

## Alternatives considered
- Require fuzz report in CI and release (rejected: increased CI latency and noise).
- Keep fuzz optional in release (rejected: weak robustness signal for publication gates).

## Consequences
- Release evaluation always includes deterministic fuzz robustness evidence.
- Triage quality improves with slow-case and seed visibility.

## Validation plan
- `npm run test:fuzz`
- `npm run eval:ci`
- `npm run eval:release`
- Confirm `reports/gates.json` includes passing `R-220` in release profile.

## Rollback plan
- Any relaxation of release fuzz requirements must be documented in a superseding ADR.
