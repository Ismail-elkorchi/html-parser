# Security policy

## Supported versions
Only the `main` branch is supported.

## Scope
This repository implements deterministic HTML parsing and evaluation tooling.

## Reporting
Report vulnerabilities privately through GitHub Security Advisories:
- https://github.com/Ismail-elkorchi/html-parser/security/advisories/new

Include:
- affected files and versions
- minimal reproduction
- expected vs actual behavior
- impact assessment

Initial triage target: within 5 business days.

## Operational guardrails
- Runtime `dependencies` stay empty.
- `src/` must not import Node builtins.
- Gate or threshold changes require ADR-002.
- Oracle and normalization changes require ADR-003.
