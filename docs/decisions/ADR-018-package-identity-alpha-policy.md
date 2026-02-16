# ADR-018: Package identity policy for public alpha readiness

Status: Accepted  
Date: 2026-02-16

## Context

The repository is still in pre-publish hardening (`private: true`) while evaluation and portability gates are being enforced on every PR.
The package identity is not yet pinned in a single decision record:
- `package.json` currently uses an internal/private package name.
- `jsr.json` needs to reflect the intended public identity and versioning posture.

Without one package identity policy, release docs and registry metadata can diverge.

## Decision

- Keep npm publishing disabled for now (`package.json` remains `private: true`).
- Define the intended public package identity as:
  - npm: `@ismail-elkorchi/html-parser`
  - JSR: `@ismail-elkorchi/html-parser`
- Keep the project in `0.x` versioning while conformance/oracle hardening remains active.
- Align `jsr.json` to the intended identity and current `0.x` version.

## Alternatives considered

- Publish now under unscoped `html-parser`.
  - Rejected: ownership/conflict risk and no registry reservation guarantee.
- Rename `package.json` immediately to the scoped public name.
  - Rejected for this PR: changing install identity before release tagging is unnecessary churn while package remains private.

## Consequences

- Release documentation can reference one intended public identity.
- Registry metadata for JSR is aligned before public publish execution.
- Final publish PR can focus on enabling publication (`private: false`) and setting final npm name without revisiting policy.

## Validation plan

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run eval:ci`
- Confirm `jsr.json` uses `@ismail-elkorchi/html-parser` and `0.x` version.
- Confirm `THIRD_PARTY_NOTICES.md` covers vendored runtime code and vendored datasets.

## Rollback plan

- If registry identity changes, add a superseding ADR and update `jsr.json` plus release docs in one PR.
- Keep this ADR as historical context for the previous identity decision.
