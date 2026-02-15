## Summary
- [ ] Describe what changed and why.
- [ ] Confirm this description is historical (what was done), not aspirational.

## User-visible changes
- [ ] List externally observable behavior or interface changes.
- [ ] If no user-visible changes, explicitly state "None".

## Evidence
- [ ] Paste commands run and summarize outputs.
- [ ] Include:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
  - `npm run eval:ci` (when implemented in this PR scope)
  - `npm run eval:release` (final release hardening PR only)

## Risk and mitigations
- [ ] List key risks introduced by this PR.
- [ ] List mitigations and rollback strategy.

## Decision records
- [ ] Link ADRs created or updated by this change.
- [ ] If no ADR changes, explicitly state "None".

## Additional checklist
- [ ] PR title is a Conventional Commit title.
- [ ] Breaking change status evaluated:
  - If breaking, PR title uses `!` and notes include migration impact.
  - If not breaking, this is explicitly stated.
- [ ] Docs are present tense and match current behavior.
