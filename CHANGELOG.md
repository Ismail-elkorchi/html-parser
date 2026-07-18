# Changelog

All notable changes are documented in this file.

## Unreleased
- Remove obsolete governance references, dead decision-file validation, and unreachable evaluation wrappers left behind by the documentation consolidation.
- Upgrade the complete development toolchain and migrate lint configuration to ESLint 10-compatible plugins.
- Upgrade every GitHub Actions dependency to its latest stable release while retaining immutable commit pins.
- Remove Dependabot configuration in favor of deliberate, consolidated dependency maintenance.

## [0.1.1] - 2026-03-04
- Add OIDC `publish.yml` workflow for npm Trusted Publishing and JSR publish on release events.
- Add publish manifest evidence and deterministic tag/version parity checks before publish.
- Documentation front door upgrade (Diataxis index + examples runner).
- Docs drift guard now verifies API reference coverage against exported functions.
- Private triage/spec snapshot artifacts moved out of public docs surface.

## [0.1.0] - 2026-03-04
- First public release of `@ismail-elkorchi/html-parser`.
- npm + JSR package metadata, docs surface, and release automation hardened for deterministic publishing.
