# Evaluation scripts

These scripts enforce acceptance gates and compute the composite score.

Typical usage:
1) Produce reports/*.json by running test suites.
2) Run:
   - node scripts/eval/check-docs.mjs
   - node scripts/eval/check-no-node-builtins.mjs
   - node scripts/eval/pack-check.mjs
   - node scripts/eval/check-gates.mjs --profile=ci
   - node scripts/eval/score.mjs --profile=ci
   - node scripts/eval/report.mjs --profile=ci

Release:
- include holdout and browser diff reports, then run with --profile=release

Outputs:
- reports/docs.json
- reports/no-node-builtins.json
- reports/pack.json
- reports/gates.json
- reports/score.json
- docs/score-report.md
