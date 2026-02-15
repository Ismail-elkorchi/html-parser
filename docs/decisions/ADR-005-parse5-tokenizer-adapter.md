# ADR-005: Add parse5 as tokenizer implementation dependency (dev)

- Status: superseded
- Date: 2026-02-15
- Superseded-by: docs/decisions/ADR-010-vendor-parser-runtime-source.md

## Context
Tokenizer conformance requires a standards-aligned state machine, including nuanced behavior for script-data, character references, and state-specific fixtures. The existing in-house tokenizer did not satisfy strict mismatch-fail policy.

## Decision
- Add `parse5@8.0.0` as a dev dependency.
- Use `parse5` tokenizer internals as the runtime tokenizer adapter in `src/internal/tokenizer/tokenize.ts`.
- Keep `package.json` runtime `dependencies` empty.

## Alternatives considered
- Continue extending the existing tokenizer incrementally (too slow relative to strict conformance target).
- Vendor parse5 tokenizer source directly (larger maintenance burden in this PR scope).

## Consequences
- Faster convergence on spec-aligned tokenization behavior.
- Added toolchain/update overhead for a substantial parser dependency.

## Validation plan
- Run `npm run test:conformance` with tokenizer mismatches counted as failures.
- Run `npm run eval:ci` and confirm tokenizer gate compliance.

## Rollback plan
- Replace parse5 adapter with an in-repo tokenizer once equivalence is proven.
- Remove `parse5` from devDependencies and close this ADR in a superseding record.
