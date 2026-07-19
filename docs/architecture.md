# Architecture

## Product boundary

html-parser owns a portable, immutable HTML tree plus deterministic operations
over it. It does not expose a browser DOM, execute scripts, compute layout, or
sanitize output.

The HTML Standard owns tokenization and tree-construction semantics. The
Encoding Standard owns byte labels and decoding. Public TypeScript types and
these user documents own product-specific contracts such as budgets, error
shapes, traces, retained source, and text policies.

## Current pipeline

```txt
string / bytes / byte stream
        │
        ├─ validate closed options, signal, and budgets
        ├─ sniff and decode when input is bytes
        ├─ build the HTML tree with the embedded legacy engine
        └─ convert and freeze the public tree, metadata, and trace

public tree
        ├─ traversal and queries
        ├─ deterministic serialization
        ├─ bounded text extraction
        ├─ outlines and chunks
        └─ source-aware patch planning
```

Byte-stream input is read and decoded incrementally, but tree construction
starts after EOF from the complete decoded string. Resource checks occur at
the work or allocation boundary. Public tree walking and downstream operations
use explicit stacks so accepted input depth does not depend on JavaScript's
call-stack limit.

The current production parser is a modified vendored parse5/entities runtime.
It installs no packages at runtime, but it remains third-party-derived code and
is identified as such in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Replacement direction

The legacy engine will be replaced by an independent standards-based
TypeScript implementation. Migration is incremental internally and atomic at
the public production boundary:

- the legacy engine remains the only production engine until the replacement
  passes its complete qualification gates;
- new engine code has test-only internal entry points while incomplete;
- there is no public engine selector, fallback, or hybrid parser;
- cutover removes the legacy engine, facade, build copy step, compatibility
  patches, and notices that no longer apply.

This avoids committing consumers to transitional architecture and prevents two
parsers from becoming a permanent compatibility burden. The allowed sources
and implementation-isolation rules are in the
[source policy](./maintainers/source-policy.md).

## Module boundaries

Public entry points should contain public contracts and thin orchestration.
Parsing mechanics, encoding, serialization, extraction, and source editing
belong in focused internal modules. New code must be strict TypeScript from its
first change; generated standards data must be reproducible and separated from
handwritten algorithms.

The current large `src/public/mod.ts` and manually duplicated JSR declarations
are migration debt, not templates. Until they are split, contract changes must
update npm and JSR surfaces together and run both documentation/type checks.

The replacement engine foundations live under `src/internal/html-engine` while
they are incomplete. That subtree has no production importer, is excluded from
npm and JSR artifacts, and is reachable only by repository tests. Its initial
standards baseline is pinned in code so later implementation work cannot
silently follow a moving Living Standard revision.

Test-only fixture conventions, serializers, corpus readers, and integrity
checks live under `test/support`. Production source must not export helpers for
adapting third-party fixture formats; conformance runners adapt those formats at
the test boundary.

## Design rules

- Standards conformance takes precedence over historical legacy behavior.
- No public compatibility alias, dual result shape, or catch-all fallback.
- Limits are explicit and checked before or at the unavailable unit.
- Results and observable event data are immutable and deterministic.
- Source offsets are decoded UTF-16 code-unit ranges with exclusive ends.
- Runtime packages remain self-contained and work offline after installation.
- Benchmarks are measurements, not permanent prose contracts; retain scripts
  and thresholds near the code that enforces them.
