# Changelog

All notable changes are documented in this file.

## Unreleased
- Remove obsolete governance references, dead decision-file validation, and unreachable evaluation wrappers left behind by the documentation consolidation.
- Upgrade the complete development toolchain and migrate lint configuration to ESLint 10-compatible plugins.
- Upgrade every GitHub Actions dependency to its latest stable release while retaining immutable commit pins.
- Remove Dependabot configuration in favor of deliberate, consolidated dependency maintenance.
- Remove the obsolete AJV override and refresh ESLint's compatible development-only validator.

- Prepare version 0.2.0 with byte-accurate input budgets and chunk-independent
  stream prescan limits.
- Release stream readers on success and failure, and preserve end-to-end time
  accounting across decoding and parsing.
- Remove the `includeSpans` compatibility alias and impossible parse-diagnostic
  variants from the public type surface.
- Repair Deno documentation-shape handling, conformance checkout guidance, and
  vulnerable development tooling.

## [0.1.1] - 2026-03-04
- Add OIDC `publish.yml` workflow for npm Trusted Publishing and JSR publish on release events.
- Add publish manifest evidence and deterministic tag/version parity checks before publish.
- Documentation front door upgrade (Diataxis index + examples runner).
- Docs drift guard now verifies API reference coverage against exported functions.
- Private triage/spec snapshot artifacts moved out of public docs surface.

## [0.1.0] - 2026-03-04
- First public release of `@ismail-elkorchi/html-parser`.
- npm + JSR package metadata, docs surface, and release automation hardened for deterministic publishing.
