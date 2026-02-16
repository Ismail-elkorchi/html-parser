# ADR-021: Doc TypeScript snippet compilation gate

Status: Accepted  
Date: 2026-02-16

## Context

Public TypeScript examples can drift from the real API surface when they are not compiled during evaluation.
Drift in examples breaks adoption and lowers trust in release documentation.

## Decision

- Add `scripts/eval/check-doc-snippets.mjs` as an evaluation artifact.
- Compile fenced `ts`/`typescript` snippets from:
  - `README.md`
  - `docs/*.md`
- Compile in `noEmit` mode using repository TypeScript and a temporary snippet tsconfig.
- Require canonical package import specifier in snippets:
  - `@ismail-elkorchi/html-parser`
- Add required gate `G-127` (`reports/doc-snippets.json ok=true`) for CI and release.

## Alternatives considered

- Keep docs snippet validation manual in review.
  - Rejected: non-deterministic and easy to miss at scale.
- Execute snippets as tests.
  - Rejected: runtime execution side effects and environment coupling are unnecessary for compile-validity checks.

## Consequences

- Documentation examples are compile-verified against the current public API.
- API and docs changes now fail fast when snippet syntax or imports drift.
- The gate remains deterministic because it performs compile-only checks.

## Validation plan

- `npm run eval:ci`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Rollback plan

- If snippet compilation causes unacceptable noise, supersede this ADR with narrower snippet scope while keeping at least README snippet compilation enforced.
