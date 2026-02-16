# ADR-016: Streaming invariants are mandatory CI evidence

- Status: accepted
- Date: 2026-02-16
- Supersedes: none

## Context
`parseStream` behavior is central to portability and memory safety, but previous CI gates did not require a dedicated streaming report artifact. Existing control tests covered baseline behavior but did not provide explicit gate evidence for chunked equivalence and buffering boundaries.

## Decision
- Add `reports/stream.json` with deterministic checks:
  - stream parsing over many chunks equals `parseBytes` for the same bytes
  - `maxBufferedBytes` enforcement fails at deterministic overflow boundary
- Add CI/release gate `G-085` requiring `reports/stream.json` with `overall.ok = true`.
- Set profile requirements:
  - `profiles.ci.requireStreamReport = true`
  - `profiles.release.requireStreamReport = true`

## Alternatives considered
- Keep streaming checks only in control tests (rejected: no explicit gate artifact).
- Require stream report only in release profile (rejected: streaming regressions should fail in CI).

## Consequences
- Streaming regressions now fail fast in CI and release evaluations.
- Streaming invariants are auditable from a single report artifact.

## Validation plan
- `npm run test`
- `npm run eval:ci`
- Confirm `reports/gates.json` contains passing `G-085`.

## Rollback plan
- Any relaxation of stream gate requirements requires a superseding ADR.
