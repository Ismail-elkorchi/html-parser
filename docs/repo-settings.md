# Repository settings

This repository uses pull-request-only delivery.

## Required branch protection (main)
- Require pull requests before merging.
- Require approving review count: `0` (PR-only enforcement with status checks).
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merging.
- Require linear history.
- Prevent force pushes.
- Prevent branch deletion.
- Apply rules to administrators.

## Required status checks
- `node`
- `deno`
- `bun`
- `dependency-review`
- `codeql-analyze`

These map to the CI jobs in `.github/workflows/ci.yml`.
`dependency-review` is defined in `.github/workflows/dependency-review.yml`.
`codeql-analyze` is defined in `.github/workflows/codeql.yml`.

## Oracle workflow
- `.github/workflows/oracle.yml` runs `npm run eval:release` on schedule and manual dispatch.
- It installs Playwright browsers (`chromium`, `firefox`, `webkit`) before release evaluation.
- This workflow is intentionally not a required pull-request check to keep PR CI latency stable.

## Applied branch protection payload
Applied with:
- `gh api -X PUT repos/Ismail-elkorchi/html-parser/branches/main/protection --input <payload>`

Payload applied:
```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["node", "deno", "bun", "dependency-review", "codeql-analyze"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
```
