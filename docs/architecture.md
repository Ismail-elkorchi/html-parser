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
        ├─ tokenize and construct one direct internal HTML tree
        └─ convert and freeze the public tree, metadata, and trace

public tree
        ├─ traversal and queries
        ├─ deterministic serialization
        ├─ bounded text extraction
        ├─ outlines and chunks
        └─ source-aware patch planning
```

After byte-stream encoding selection, decoded chunks feed tree construction
incrementally. Exact decoded text is retained only when requested, and stream
conversion releases internal tree storage as the immutable public tree is
built. Resource checks occur at the work or allocation boundary. Public tree
walking and downstream operations use explicit stacks so accepted input depth
does not depend on JavaScript's call-stack limit.

Production uses one independent standards-based TypeScript engine. There is no
public engine selector, fallback, hybrid parser, installed runtime dependency,
or copied third-party parser implementation. The allowed implementation
sources and isolation rules are in the repository's
[source policy](https://github.com/Ismail-elkorchi/html-parser/blob/main/docs/maintainers/source-policy.md).

## Module boundaries

`src/mod.ts` is the sole public export list, and `src/public/types.ts` is the
sole portable public type model. The JSR entrypoint re-exports that root; it
does not redeclare types or wrap functions.

Source modules use explicit `.ts` relative specifiers so Deno checks the same
graph without resolution flags. TypeScript rewrites those specifiers to `.js`
in npm runtime output; there is no second implementation tree.

Public implementation is separated by independently testable responsibility:
parsing, serialization, text extraction, querying/traversal, outlining,
patching, and chunking. Shared public-tree ownership rules and namespace
constants live in the model module. Input/decoding, option normalization,
tracing, budgets, and parsed-document identity each have one operation-level
owner. Platform entrypoints contain no business logic.

New code must be strict TypeScript from its first change; generated standards
data must be reproducible and separated from handwritten algorithms.
The compiler checks library declarations instead of using `skipLibCheck`.
Declaration output remains compiler-generated from the canonical source graph.

The parser engine lives under `src/internal/html-engine` and is imported only
through the public parsing owner. It is included in npm and JSR artifacts as
private runtime code but is not exported. Its standards baseline is pinned in
code so maintenance cannot silently follow a moving Living Standard revision.
Private source has no aggregate export barrel: production code, tests, and
evidence runners import the module that owns each name. A syntax-aware graph
gate rejects unresolved edges, cycles, reversed layers, extra engine ingress,
dead modules, and direct access to generated data.

Within that boundary, tokenization feeds tree construction synchronously. The
document and fragment drivers build the direct internal tree without a token
batch or compatibility adapter.

Formatting recovery is also mutation-time state, not a post-parse correction:
a marker-generation-aware active-formatting list owns Noah-family and subject
indexes, while the open-element stack owns scope and bounded random access.
Reconstruction and adoption create and move nodes only through the direct tree
model, with every unbounded scan or subtree move charged to the shared guard.

Private state contradictions use the shared internal foundation error and
machine-readable reasons; they are library defects, not public operational
errors. Production TypeScript may not throw unclassified generic `Error`
instances. Configuration, resource, cancellation, callback, and parse failures
retain their separate contracts.

Test-only fixture conventions, corpus readers, oracle adapters, and integrity
checks live under `test/support`. Production source must not export helpers for
adapting third-party fixture formats; conformance runners adapt those formats at
the test boundary. Public serialization tests invoke the built public export,
so no parallel test renderer can mask a production defect.

## Design rules

- Standards conformance takes precedence over historical behavior.
- No public compatibility alias, dual result shape, or catch-all fallback.
- Limits are explicit and checked before or at the unavailable unit.
- Results and observable event data are immutable and deterministic.
- Source offsets are decoded UTF-16 code-unit ranges with exclusive ends.
- Runtime packages remain self-contained and work offline after installation.
- Benchmarks are measurements, not permanent prose contracts; retain scripts
  and thresholds near the code that enforces them.
