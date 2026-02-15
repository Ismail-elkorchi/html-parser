# ADR-005: Add dev dependency baseline for TypeScript and lint tooling

- Status: accepted
- Date: 2026-02-15

## Context
The project requires strict type checking, deterministic linting, and reproducible local/CI execution under PR-only workflow constraints.

## Decision
Add dev dependency baseline:
- `typescript@5.9.3`
- `eslint@9.39.2`
- `@eslint/js@9.39.2`
- `typescript-eslint@8.55.0`
- `eslint-plugin-import@2.32.0`
- `eslint-plugin-boundaries@5.4.0`
- `eslint-import-resolver-typescript@4.4.4`

Usage scope:
- local lint/typecheck/build scripts
- CI policy enforcement
- architecture boundary checks

## Alternatives considered
- TypeScript only with no linter (insufficient architectural enforcement).
- Biome-only configuration (insufficient boundary policy support for this baseline).
- Prettier + ESLint split formatting stack (higher toolchain surface).

## Consequences
- Additional dev-only supply chain surface.
- Increased CI runtime from lint and type-aware rules.
- Deterministic policy checks become enforceable.

## Validation plan
- `package.json` keeps `dependencies` empty.
- `npm run lint`, `npm run typecheck`, `npm run build` pass in CI.
- `scripts/eval/check-no-node-builtins.mjs` enforces runtime import policy.

## Rollback plan
- Replace architecture rules with narrower custom checks under `scripts/eval/`.
- Remove linter plugins and simplify to TypeScript compiler checks.
- Update `docs/debt.md` entries to record removal completion.

## Links
- `docs/debt.md`
