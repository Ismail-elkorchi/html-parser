# CI Failure Postmortem (v0.1.1 Publish)

## Scope
- Workflow: `Publish`
- Trigger: release `v0.1.1`
- Run: https://github.com/Ismail-elkorchi/html-parser/actions/runs/22651365067
- Failing step: `Run JSR publish dry-run`

## What failed?
`npx -y jsr publish --dry-run` exited with code `1` in the publish workflow.

## Why did it fail?
Two mechanisms were visible in the failed step log:
1. `scripts/eval/check-gates.mjs` raised JSR dynamic-import analysis warnings at `:254:39`, `:330:39`, and `:388:39` (`unable to analyze dynamic import`).
2. The dry-run then aborted on dirty working tree state (`Aborting due to uncommitted changes`) after writing publish artifacts during the same job.

The net effect was a blocked publish pipeline before any registry publish step.

## What change in this PR series removes the failure?
The release/tooling PR in this series makes the dry-run path resilient by:
- keeping non-package scripts out of publish analysis scope,
- preserving dry-run execution even when workflow artifacts are produced,
- and adding a manual publish workflow that validates the same path safely with `dry_run=true`.

## Proof
- Workflow evidence: https://github.com/Ismail-elkorchi/html-parser/actions/runs/22651365067
- Log extraction command:
  ```bash
  gh run view 22651365067 --log-failed
  ```
