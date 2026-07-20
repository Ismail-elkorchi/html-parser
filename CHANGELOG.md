# Changelog

All notable changes are documented in this file.

## Unreleased

- Replace staged parser evidence and score-based evaluation wrappers with one
  direct test/qualification command surface; make fixture refreshes
  transactional, package checks exercise the installed tarball, mutation run
  in an isolated workspace, and release/publish validation fail closed.
- Make WPT the sole tree-construction corpus, remove the html5lib-tests
  submodule and duplicate legacy tree runner, and retain only manifest-verified
  tokenizer and encoding snapshots with stable upstream fixture identities.
- Separate product, engine, type-contract, tooling, support, and fixture test
  ownership; delete inert bootstrap tests and misleading terminal-oracle code;
  consolidate visible-text snapshots; and execute complete conformance corpora
  without artificial holdout partitions.

- Replace the tag-name-only fragment API with one normalized namespace-aware
  context and explicit scripting, owner-document mode, and external
  form-ancestor inputs; derive and retain the effective environment on fragment
  results, preserve it during serialization/chunking, and qualify the built API
  against every pinned WPT fragment plus focused Chromium, Firefox, and WebKit
  contexts.

- Consolidated release performance evidence into one balanced cross-revision
  report: accepted independent parser and corrected serializer revisions are
  enforced while tagged `v0.1.1` remains a report-only recovery horizon.

- Pin the maintained WPT serialization directory and qualify the built public
  serializer against explicit expectations, structural round trips, exact
  non-roundtrip classifications, and Chromium, Firefox, and WebKit.
- Correct HTML serialization for parent-sensitive raw text, namespace
  boundaries, escaping, names, and extended void elements; make source patches
  use the same rules and replace the unrelated fixture serializer gate with
  direct built-package coverage.
- Enforce syntax-aware source layers and declaration reachability, remove dead
  private barrels and migration-era adapter code, consolidate tokenizer corpus
  ownership, enable full library type checking, and publish only runtime code,
  reachable public declarations, user documentation, and required legal files.
- Route every public parsing entrypoint through the independent TypeScript
  engine; delete the embedded parse5/entities runtime, compatibility facade,
  copy/seal/differential infrastructure, stale notices, and copied-source
  fingerprints; and require self-contained npm and strict Deno/JSR module
  graphs with no installed runtime dependencies.
- Qualify the independent engine across the complete pinned tree corpus,
  browser and frozen product differentials, deterministic fuzzing, mutation, resource,
  performance, cross-runtime, packed-package, audit, SBOM, and provenance
  gates; correct element-span closure, template depth accounting, model-state
  ownership, namespace scope lookup, and qualification watchdog semantics found
  by that work.
- Unify npm/Node and JSR around one canonical public export and TypeScript
  model, remove JSR-only aliases and wrapper declarations, split public
  features by responsibility, and add exact surface, documentation, and packed
  strict-consumer checks.
- Implement parser-owned option selectedness and direct selectedcontent cloning
  at every option-pop boundary, add atomic spanless subtree replacement, and
  stop retaining detached historical allocations in the tree model.
- Implement standards-derived foreign-content dispatch and fragment parsing in
  the independent engine, including HTML/SVG/MathML integration points, exact
  SVG/MathML/foreign attribute adjustment, CDATA feedback, context-sensitive
  tokenizer entry states, namespace-aware scope recovery, and whole/unit-chunk
  WPT and browser qualification.
- Add direct table, foster-parenting, template, relaxed-select, frameset, and
  trailing-document tree construction to the independent engine, with exact
  contextual diagnostics, deterministic mutation traces, and WPT/browser/
  resource qualification.
- Implement independent active-formatting reconstruction, Noah-family limits,
  bounded adoption recovery, and related in-body form/list/button/ruby rules on
  direct typed tree mutations, with indexed state and browser/WPT evidence.
- Add the independent engine's synchronous document driver and basic HTML tree
  construction through in-body/text/after-body modes, including complete
  DOCTYPE mode selection, indexed scope queries, typed unnamed diagnostics,
  processing-instruction nodes, exact token feedback, and assigned WPT proof;
  remove the obsolete preprocessing-only driver.
- Add the independent engine's direct document/fragment tree model with typed
  namespace-aware nodes and mutations, explicit template contents, exact span
  handling, separated allocation/depth accounting, and stack-safe validation.
- Replace ad hoc internal assertion messages with one private structured error
  category, make tokenizer execution states compile-time exhaustive, remove
  redundant completion state, and fail explicitly instead of silently dropping
  incomplete tree conversions.
- Complete the isolated incremental tokenizer across text end tags, script
  escaped and double-escaped states, CDATA, processing instructions, exact
  diagnostics, synchronous parser feedback, and bounded resources; integrate
  the independent character-reference consumer in text and attribute contexts,
  and verify the complete applicable fixture corpus across adversarial chunk
  schedules.
- Generate a compact named-character-reference table from separately pinned
  WHATWG data and add an isolated incremental consumer with longest-match,
  attribute-context, numeric-replacement, exact diagnostic, and resource
  behavior covered by the complete applicable html5lib fixture set.
- Consolidate tests under one taxonomy, compile strict TypeScript runtime and
  type-contract suites independently, move fixture adaptation out of runtime
  source, require complete upstream fixture inventories, remove dead
  token-to-tree production helpers, and extend mutation checks beyond encoding.
- Add isolated strict-TypeScript foundations for the independent HTML engine,
  including incremental decoded-input preprocessing, exact UTF-16 positions,
  closed token and diagnostic types, synchronous control boundaries, hard
  resource checkpoints, and internal observer contracts.
- Pin the maintained WPT tree-construction corpus for deterministic offline
  testing, preserve exact provenance and licenses, and consolidate `.dat`
  decoding in test support while retaining every existing tree fixture.
- Return one `ParsedDocument` from all full-document entrypoints with optional
  exact decoded-source retention, encoding evidence, and successful resource
  observations; freeze parser-owned trees and require patch plans to retain the
  exact parse-result identity.
- Preserve element and attribute namespace identity, expose shared HTML and
  exact-namespace query helpers, and align Node/npm and JSR tree types.
- Replace ambiguous optional doctype identifiers with an exact external-ID
  union and serialize valid `PUBLIC`/`SYSTEM` declarations without collapsing
  explicit empty identifiers.
- Apply HTML void-element rules only in the HTML namespace, document exact
  UTF-16 span semantics, and make deep conversion, traversal, serialization,
  extraction, outline, patch, and chunk paths stack-safe.
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
- Decode long zero-prefixed and out-of-range numeric character references
  without arithmetic overflow failures.
- Remove obsolete governance references, dead decision-file validation, and unreachable evaluation wrappers left behind by the documentation consolidation.
- Upgrade the complete development toolchain and migrate lint configuration to ESLint 10-compatible plugins.
- Upgrade every GitHub Actions dependency to its latest stable release while retaining immutable commit pins.
- Remove Dependabot configuration in favor of deliberate, consolidated dependency maintenance.
- Remove the obsolete AJV override and refresh ESLint's compatible development-only validator.
- Replace overlapping eager text helpers with one policy-versioned bounded
  result API and one token iterator; require output, token, and visible-text
  fallback limits; preserve scalar-safe UTF-8 prefixes and exact total-byte
  measurements; and expose coalesced source provenance on both package roots.

- Make input budgets byte-accurate and stream encoding-prescan limits
  independent of producer chunk boundaries.
- Release stream readers on success and failure, and preserve end-to-end time
  accounting across decoding and parsing.
- Remove the `includeSpans` compatibility alias and impossible parse-diagnostic
  variants from the public type surface.
- Support both structured and flat Deno documentation output, and add actionable
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
