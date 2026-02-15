# Update playbook (datasets and fixtures)

Goal:
Update pinned datasets without breaking correctness or drifting the meaning of "best".

Procedure:
1) Create ADR-004 describing the dataset update scope and risk.
2) Update fixture and dataset pins:
   - `vendor/html5lib-tests` submodule commit
   - `vendor/whatwg/entities.json` snapshot
3) Regenerate derived files:
   - regenerate `src/internal/entities.ts` from `vendor/whatwg/entities.json`
4) Update records:
   - `docs/spec-snapshots.md`
   - `docs/third-party.md`
   - `THIRD_PARTY_NOTICES.md` if source/license text changes
5) Run verification commands:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`
   - `npm run test:control`
   - `npm run eval:ci`
   - `npm run eval:release`
6) If behavior changes:
   - add/update divergence records in `docs/triage/`
   - choose ADR-003 for oracle/normalization changes or ADR-002 for gate/threshold changes
7) Do not ship if the release profile fails.
