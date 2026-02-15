# Evaluation report (release)

Generated from JSON reports under `reports/`.

## Gates

Overall: **PASS**

- **G-000** Evaluation config exists: PASS
- **G-010** Zero runtime dependencies: PASS
- **G-020** ESM only: PASS
- **G-030** No Node builtin imports in src/: PASS
- **G-040** Conformance tokenizer: PASS
- **G-050** Conformance tree construction: PASS
- **G-060** Conformance encoding: PASS
- **G-070** Conformance serializer: PASS
- **G-080** Determinism: PASS
- **G-090** Budgets and no hangs: PASS
- **G-100** Cross-runtime smoke: PASS
- **G-110** Packaging sanity: PASS
- **G-120** Docs and dataset hygiene: PASS
- **R-200** Holdout suite: PASS
- **R-210** Browser differential oracle: PASS

## Score

Total: **85.000 / 100**

- **correctness**: 25.000
- **browserDiff**: 20.000
- **performance**: 15.000
- **robustness**: 10.000
- **agentFirst**: 10.000
- **packagingTrust**: 5.000

## Decision records required

- Any fixture skip MUST have an ADR (ADR-001).
- Any threshold or gate change MUST have an ADR (ADR-002).
- Any oracle choice or normalization rule MUST have an ADR (ADR-003).
- Any dataset update MUST have an ADR (ADR-004).
- Any dev dependency addition MUST have an ADR (ADR-005) and a debt entry in docs/debt.md.

## Decision records referenced

- docs/decisions/ADR-001-encoding-malformed-meta-skips.md
- docs/decisions/ADR-001-serializer-conformance-skips.md
- docs/decisions/ADR-001-tokenizer-conformance-skips.md
- docs/decisions/ADR-001-tree-construction-conformance-skips.md
- docs/decisions/ADR-002-staged-threshold-realignment.md
- docs/decisions/ADR-003-browser-diff-normalization-v1.md

