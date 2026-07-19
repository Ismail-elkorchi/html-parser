# Changelog

All notable changes are documented in this file.

## Unreleased
- Replace boolean trace capture with explicit none/summary/events modes, a
  synchronous immutable event observer, exact canonical UTF-8 retention
  budgets, and a linear append-only trace pipeline.
- Rename the stream encoding-prefix control to
  `maxEncodingPrescanBytes`, separate stream-specific option types from
  non-stream parse options, and report prescan high-water data on stream traces.
- Replace the misleading token-stream iterator with
  `tokenizeByteStreamEager()`, which returns one promised token collection after
  EOF, and document full-document buffering and peak-memory ownership.
- Validate closed parser option schemas and hard-stop node, depth, parse-error,
  attribute, decoded-output, trace, input, and monotonic-time budgets at the
  first unavailable unit.
- Add abort signals and operation deadlines across parsing, stream reads,
  serialization, traversal, and text extraction, with exact abort reasons and
  deterministic stream cleanup.
- Replace nested generic error payloads with HTML-specific operational error
  classes, direct frozen fields, cross-realm structural guards, and preserved
  stream-read causes.
- Parse documents and fragments in a single parse5 pass, report the actual
  context-sensitive token count, and remove the catch-all legacy tokenizer
  fallback and its unused generated entity dataset.
- Decode long zero-prefixed and out-of-range numeric character references
  without arithmetic overflow failures.
- Remove obsolete governance references, dead decision-file validation, and unreachable evaluation wrappers left behind by the documentation consolidation.
- Upgrade the complete development toolchain and migrate lint configuration to ESLint 10-compatible plugins.
- Upgrade every GitHub Actions dependency to its latest stable release while retaining immutable commit pins.
- Remove Dependabot configuration in favor of deliberate, consolidated dependency maintenance.
- Remove the obsolete AJV override and refresh ESLint's compatible development-only validator.

- Make input budgets byte-accurate and stream encoding-prescan limits
  independent of producer chunk boundaries.
- Release stream readers on success and failure, and preserve end-to-end time
  accounting across decoding and parsing.
- Remove the `includeSpans` compatibility alias and impossible parse-diagnostic
  variants from the public type surface.
- Support current and legacy Deno documentation shapes, and add actionable
  conformance-submodule setup guidance.

## [0.1.1] - 2026-03-04
- Add OIDC `publish.yml` workflow for npm Trusted Publishing and JSR publish on release events.
- Add publish manifest evidence and deterministic tag/version parity checks before publish.
- Documentation front door upgrade (Diataxis index + examples runner).
- Docs drift guard now verifies API reference coverage against exported functions.
- Private triage/spec snapshot artifacts moved out of public docs surface.

## [0.1.0] - 2026-03-04
- First public release of `@ismail-elkorchi/html-parser`.
- npm + JSR package metadata, docs surface, and release automation hardened for deterministic publishing.
