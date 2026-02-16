# Readiness

Readiness is defined by evaluation gates and report evidence, not by embedded counts in documentation.

## Definition
- A build is ready only when all required gates pass for the selected profile in `evaluation.config.json`.
- CI readiness is proven by `eval:ci`.
- Release readiness is proven by `eval:release`.

## Evidence model
- Evaluation reports are generated under `./reports/` by test and evaluation commands.
- Reports are build artifacts and are not committed to git.
- A human-readable summary is generated at `reports/eval-report.md`.
- Readiness claims must cite current report artifacts, not static numbers copied into docs.

## Required commands
- `npm run eval:ci`
- `npm run eval:release`
- `npm run test:conformance`
- `npm run test:holdout`
- `npm run test:browser-diff`

## Operational use
- Use `eval:ci` for day-to-day gate validation in pull requests.
- Use `eval:release` for strict release validation, including holdout and browser differential evidence.
- Investigate failures by reading the corresponding JSON files under `reports/`.
