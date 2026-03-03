# Mutation Pilot (Advisory)

This document describes the first mutation-testing pilot for `html-parser`.

## Scope

Pilot target:
- `dist/internal/encoding/sniff.js`

Pilot exclusions:
- browser-oracle integration paths
- fuzz, conformance, and runtime smoke pipelines
- release workflow logic

Why this scope:
- Encoding sniffing is deterministic and high-impact for parser correctness.
- The module has stable control tests that make survivor triage actionable.
- The pilot can run in bounded time as a non-blocking advisory signal.

## Commands

```bash
npm run mutation:pilot
```

The pilot command builds once, applies configured mutants, and runs focused control tests:
- config: `scripts/mutation/pilot-config.json`
- output: `docs/reference/mutation-pilot-report.json`

## Baseline and hardening delta

Baseline snapshot (before hardening tests):
- report: `docs/reference/mutation-pilot-report-baseline.json`
- result: `killed=1`, `survived=3`, `total=4`

Survivors identified in baseline:
- `alias-windows1252`
- `meta-utf16-fallback`
- `strip-comments-disabled`

Hardening changes introduced in this pilot:
- strengthened alias coverage using `latin-1` label normalization expectations
- strengthened UTF-16 canonicalization coverage using `unicode` label normalization
- added a control test asserting unterminated comments block charset prescan

Final pilot result after hardening:
- report: `docs/reference/mutation-pilot-report.json`
- result: `killed=4`, `survived=0`, `total=4`

## Residual risk

This pilot is advisory and narrow by design.
Mutation results do not replace release validation (`npm run eval:release`) and do not yet gate merges.
