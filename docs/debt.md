# Dev tooling debt ledger

Rules:
- Every devDependency must be recorded here.
- Every devDependency addition must have ADR-005.

## typescript@5.9.3
Value:
- Strict compile-time validation and declaration emission.
Cost:
- Extra CI runtime and config maintenance.
Removal plan:
- Replace with equivalent TypeScript-compatible compiler pipeline if selected later.
ADR:
- docs/decisions/ADR-005-dev-toolchain-baseline.md

## eslint@9.39.2
Value:
- Deterministic linting with CI-stable diagnostics.
Cost:
- Additional dependency and lint execution time.
Removal plan:
- Remove when policy checks are replaced by equivalent static gates.
ADR:
- docs/decisions/ADR-005-dev-toolchain-baseline.md

## @eslint/js@9.39.2
Value:
- Baseline JS rule set integrated with flat config.
Cost:
- Config synchronization with ESLint core versions.
Removal plan:
- Remove with ESLint stack replacement.
ADR:
- docs/decisions/ADR-005-dev-toolchain-baseline.md

## typescript-eslint@8.55.0
Value:
- Type-aware lint rules for async misuse and unsafe patterns.
Cost:
- Type-program build overhead for lint runs.
Removal plan:
- Remove if equivalent compiler-only checks cover risk profile.
ADR:
- docs/decisions/ADR-005-dev-toolchain-baseline.md

## eslint-plugin-import@2.32.0
Value:
- Import hygiene and deterministic import ordering.
Cost:
- Rule maintenance across ecosystem updates.
Removal plan:
- Remove when import policy is enforced by alternative deterministic linter.
ADR:
- docs/decisions/ADR-005-dev-toolchain-baseline.md

## eslint-plugin-boundaries@5.4.0
Value:
- Architectural layer enforcement for `src/public`, `src/internal`, and tests.
Cost:
- Plugin compatibility tracking.
Removal plan:
- Replace with equivalent custom static boundary checks before removal.
ADR:
- docs/decisions/ADR-005-dev-toolchain-baseline.md

## eslint-import-resolver-typescript@4.4.4
Value:
- Stable module resolution for TypeScript import linting.
Cost:
- Additional resolver dependency.
Removal plan:
- Remove when resolver-free import checks are feasible.
ADR:
- docs/decisions/ADR-005-dev-toolchain-baseline.md

## playwright@1.58.2
Value:
- Real multi-engine browser oracle (Chromium/Firefox/WebKit) for release differential checks.
Cost:
- Large browser download footprint and additional CI runtime in oracle workflows.
Removal plan:
- Keep oracle isolated to scheduled/manual workflows, then replace with a smaller equivalent harness if coverage parity is preserved.
ADR:
- docs/decisions/ADR-005-playwright-browser-oracle.md
