# Holdout suite policy

## Selection
- Select holdout fixture paths deterministically from `html5lib-tests` using a fixed seed.
- Use a stable lexical ordering of candidate fixture paths before sampling.
- Use the same seed in CI and local runs.

## Execution policy
- Holdouts are excluded until the final audit milestone.
- Do not include holdout files in routine CI profile runs.
- When holdouts are executed, write a machine-readable report to `reports/holdout.json`.

## Reproducibility
- Record seed, fixture commit, and selected file list in run metadata.
