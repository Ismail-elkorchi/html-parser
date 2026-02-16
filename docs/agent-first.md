# Agent-first completeness

Agent-first behavior is measured as observable runtime and evaluation outcomes.

## Checklist
- Deterministic identifiers:
  - repeated parse runs with identical input and options produce stable NodeId assignment.
- Bounded trace:
  - trace output is bounded by `maxTraceEvents` and `maxTraceBytes`.
  - trace output is deterministic under identical input and options.
- Span coverage for rewrite planning:
  - `captureSpans: true` exposes source spans for patch-targetable nodes.
- Deterministic outline and chunk:
  - `outline(tree)` and `chunk(tree, options)` produce stable output for stable input.
- Deterministic visible-text extraction:
  - `visibleText(...)` and `visibleTextTokens(...)` follow `docs/visible-text.md`.
  - fixture snapshots under `test/fixtures/visible-text/v1/` are stable across repeated runs.
- Structured budget failures:
  - budget limits raise `BudgetExceededError` with structured payload.
- Parse-error taxonomy:
  - parser errors expose deterministic `parseErrorId`.
  - `getParseErrorSpecRef(parseErrorId)` provides a stable spec-reference URL.

## Verification surface
- `reports/agent.json`
- `reports/stream.json`
- `reports/determinism.json`
- `reports/budgets.json`
- `reports/gates.json`
- `test/fixtures/visible-text/v1/`
