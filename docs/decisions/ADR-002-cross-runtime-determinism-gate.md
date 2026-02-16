# ADR-002: Cross-runtime determinism gate for Node, Deno, and Bun

Status: Accepted  
Date: 2026-02-16

## Context

The project requires deterministic parser behavior for agent workflows across supported runtimes.
Within-runtime checks alone do not detect runtime-specific serialization differences.

## Decision

- Extend smoke runtime evidence to include `determinismHash` for each runtime report:
  - `reports/smoke-node.json`
  - `reports/smoke-deno.json`
  - `reports/smoke-bun.json`
- Build `reports/determinism.json` with:
  - `runtimes.node.hash`
  - `runtimes.deno.hash`
  - `runtimes.bun.hash`
  - `crossRuntime.ok`
  - `overall.ok`
- Require Node + Deno + Bun determinism evidence in `evaluation.config.json`.
- Fail gate `G-080` when any runtime hash is missing or hashes disagree.

Deterministic fixture input used for runtime hash generation:
- `<!doctype html><title>x</title><body><p a='1'>txt<span></p></body>`

Canonical hash payload must include:
- Node ids
- Node kinds
- Attributes
- Text values
- Spans when present
- Parse errors when present

## Alternatives considered

- Keep determinism as Node-only.
  - Rejected: misses cross-runtime drift.
- Use runtime-specific hash inputs.
  - Rejected: cross-runtime equality becomes non-comparable.

## Consequences

- CI and release now reject runtime drift between Node, Deno, and Bun.
- Determinism evidence becomes directly auditable in reports.

## Validation plan

- `npm ci`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run eval:ci`
- `npm run eval:release`

## Rollback plan

- Revert determinism hash wiring and gate requirement in one PR if a runtime support regression blocks releases, then re-introduce with corrected runtime handling.
