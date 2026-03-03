# Architecture and Tradeoffs

`html-parser` is designed for deterministic, bounded parsing in agent and automation workflows.

## Core architecture
- Public API in `src/public/mod.ts` and `src/public/types.ts`.
- Internal tokenizer/tree/serializer modules under `src/internal/`.
- No runtime dependencies in production path.

## Design priorities
1. Determinism over best-effort permissiveness.
2. Bounded execution using explicit budgets.
3. Portable runtime behavior across Node, Deno, Bun, and browsers.
4. Evidence-driven release gates in `scripts/eval/`.

## Tradeoffs
- Not a DOM implementation.
- Not a sanitizer.
- Strict gates can increase release preparation time but reduce regression risk.
- Deterministic behavior may differ from browser internals on unsupported edge cases; those deltas are tracked through evaluation reports.
