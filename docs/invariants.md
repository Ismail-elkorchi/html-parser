# Invariants (technical)

Runtime invariants:
- `package.json` runtime dependencies are empty.
- ESM only (`"type": "module"`).
- `src/` must not import Node builtin modules.

Correctness invariants:
- Determinism is mandatory for tree, ids, trace, and serialization.
- Resource budgets are mandatory and emit structured failures.
- Conformance datasets and fixture sources are pinned.
- No fixture skip is allowed without ADR-001.

Governance invariants:
- Gate and threshold changes require ADR-002.
- Oracle and normalization changes require ADR-003.
- Dataset updates require ADR-004.
- Dev dependency additions require ADR-005 and `docs/debt.md` entry.
