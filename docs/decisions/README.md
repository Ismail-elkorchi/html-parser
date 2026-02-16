# Architecture & evaluation decision records (ADRs)

Rules:
1) Decisions that affect “best” status must be written down.
2) ADRs are numbered and immutable once accepted (append new ADRs if decisions change).

Naming:
- ADR-000-template.md (do not edit)
- ADR-001-... historical fixture skip records and templates
- ADR-002-... gate and threshold policy changes
- ADR-003-... historical oracle choice and normalization records
- ADR-004-... dataset updates (fixtures, entities)
- ADR-005-... dev dependency additions
- ADR-006/007/008-... conformance mismatch hard-failure policy by suite
- ADR-009-... strict gate enforcement
- ADR-010-... runtime source vendoring policy
- ADR-011-... unified conformance mismatch-failure policy (supersedes staged skip records)
- ADR-012-... multi-engine browser differential oracle policy
- ADR-013-... strict threshold posture consolidation
- ADR-014-... browser differential corpus size and tag coverage thresholds
- ADR-015-... release fuzz report requirement and structured fuzz diagnostics
- ADR-016-... streaming invariant report and CI gate requirement

Minimum sections:
- Context
- Decision
- Alternatives considered
- Consequences
- Validation plan
- Rollback plan
