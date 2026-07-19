# Maintainer guide

Use the repository root files for project policy:

- [CONTRIBUTING.md](../../CONTRIBUTING.md) — change workflow and local checks
- [RELEASING.md](../../RELEASING.md) — publication procedure
- [SECURITY.md](../../SECURITY.md) — vulnerability handling
- [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) — shipped and test-data provenance

The maintainer pages here cover facts that are specific to implementation work:

- [Testing](./testing.md) — which command answers which question
- [Conformance corpora](./corpora.md) — pins, ownership, and refresh rules
- [Implementation source policy](./source-policy.md) — allowed and prohibited
  sources for the independent parser

Start architectural changes with [the architecture overview](../architecture.md).
Keep durable contracts in types, executable tests, or user documentation.
Generated reports belong in `reports/`; PR measurements and review narratives
belong in their PR, not in a permanent parallel documentation system.
