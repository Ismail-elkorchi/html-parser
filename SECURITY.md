# Security policy

## Scope
This repository implements deterministic HTML parsing and evaluation tooling.

## Reporting
Report vulnerabilities privately through GitHub security advisories.
Include:
- affected files and versions
- minimal reproduction
- expected vs actual behavior
- impact assessment

## Operational guardrails
- Runtime `dependencies` stay empty.
- `src/` must not import Node builtins.
- Gate or threshold changes require ADR-002.
- Oracle and normalization changes require ADR-003.
