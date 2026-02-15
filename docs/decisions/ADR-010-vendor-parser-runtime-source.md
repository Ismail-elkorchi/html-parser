# ADR-010: Vendor parser runtime source to remove external runtime imports

- Status: accepted
- Date: 2026-02-15
- Supersedes: docs/decisions/ADR-005-parse5-tokenizer-adapter.md

## Context
`G-012` now enforces that compiled `dist/` output contains no bare external package imports. The previous runtime adapter imported `parse5` from `node_modules`, which violated this gate and made runtime self-containment depend on installation layout.

The parser must remain standards-aligned while keeping runtime dependencies empty.

## Decision
- Vendor the required parser runtime sources in-repo:
  - `src/internal/vendor/parse5/` (parser/tokenizer/common/tree-adapter subset)
  - `src/internal/vendor/entities/` (decoder subset required by tokenizer)
- Add `src/internal/vendor/parse5-runtime.ts` as the internal runtime entrypoint.
- Switch production tokenizer and tree builder imports to `../vendor/parse5-runtime.js`.
- Add deterministic build copy step (`scripts/build/copy-vendor.mjs`) so vendored runtime files are present in `dist/internal/vendor/`.
- Remove `parse5` from `devDependencies`.

## Alternatives considered
- Keep external `parse5` runtime import and weaken gates (rejected).
- Rewrite tokenizer/tree from scratch in this PR (rejected for scope and regression risk).

## Consequences
- Runtime artifacts are self-contained with no external package imports.
- Conformance behavior remains stable because parser/tokenizer logic remains standards-derived.
- Vendored source refresh now requires explicit maintenance and attribution updates.

## Validation plan
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test:conformance`
- `npm run eval:ci`

## Rollback plan
- If critical regression appears, revert the vendored runtime entrypoint wiring and restore previous adapter in a dedicated rollback PR, while keeping gate history and incident evidence.
