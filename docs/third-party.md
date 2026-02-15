# Third-party datasets and fixtures

Record all vendored datasets and fixtures here.

## html5lib-tests
Source:
- https://github.com/html5lib/html5lib-tests
Pinned version (commit/hash):
- `8f43b7ec8c9d02179f5f38e0ea08cb5000fb9c9e`
Fetch date:
- `2026-02-15`
License:
- MIT (`vendor/html5lib-tests/LICENSE`)
Attribution notes:
- Upstream fixture corpus maintained by html5lib contributors.
Update procedure:
- Update submodule to a specific commit on a dedicated branch.
- Record new commit in `docs/spec-snapshots.md`.
- Create ADR-004 for the dataset update.
Verification procedure (commands):
- `git submodule status`
- `npm run test:control`
- `npm run eval:ci`
- `npm run eval:release`
ADR (for updates):
- `docs/decisions/ADR-004-*.md`

## WHATWG entities dataset
Source:
- https://html.spec.whatwg.org/entities.json
Pinned version (commit/hash):
- sha256 `d741d877ac77c4194c4ad526b5b4a19aef8dfe411ab840a466891cdbb9f362e6`
Fetch date:
- `2026-02-15`
License:
- HTML Standard content license (CC BY 4.0) and WHATWG attribution requirements.
Attribution notes:
- Vendored snapshot stored at `vendor/whatwg/entities.json`.
- Generated lookup committed at `src/internal/entities.ts`.
Update procedure:
- Fetch the latest `entities.json` into `vendor/whatwg/entities.json`.
- Regenerate `src/internal/entities.ts`.
- Recompute and record sha256 in `docs/spec-snapshots.md`.
- Create ADR-004 for the dataset update.
Verification procedure (commands):
- `sha256sum vendor/whatwg/entities.json`
- `npm run build`
- `npm run test:control`
- `npm run eval:ci`
ADR (for updates):
- `docs/decisions/ADR-004-*.md`
