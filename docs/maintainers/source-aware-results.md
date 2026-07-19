# Source-Aware Parse Result Evidence

This note records the resource, encoding, source-ownership, and patch-identity
evidence for the canonical full-document result. The public contract is in the
[data model](../reference/data-model.md) and [options reference](../reference/options.md).

## Method

- Runtime: Node 24.14.0 on Linux x64.
- Baseline: merged revision `6747581`.
- Candidate fixture: `test/control/parse-result-metadata.test.js`.
- Text, byte, and stream inputs run through their public entrypoints. Stream
  encoding cases also run as one-byte chunks so results cannot depend on
  producer chunk boundaries.
- `v0.1.1` and `6747581` return only a tree. Their partial encoding and
  reachable-tree metrics are available only when trace retention is enabled;
  neither exposes exact decoded source, attempted-allocation counters, or a
  patch-plan binding to the parse result.

## Successful resource observations

The candidate collects counters in the same decode, parse5 adapter, and trace
sink that enforce their corresponding limits. It does not recount only the
reachable public tree after recovery.

| Fixture | Input / decoded UTF-8 / UTF-16 | Nodes / max depth / errors | Attributes / attribute UTF-8 | Prescan |
| --- | ---: | ---: | ---: | ---: |
| Text `<p>é</p>` | 9 / 9 / 8 | 6 / 5 / 1 | 0 / 0 | 0 |
| Text `<p a=1 a=2 é=€>x</p>` | 23 / 23 / 20 | 6 / 5 / 2 | 3 / 9 | 0 |
| Windows-1252 bytes `<p>\x80</p>` | 8 / 10 / 8 | 6 / 5 / 1 | 0 / 0 | 0 |
| Same bytes as a two-chunk stream | 8 / 10 / 8 | 6 / 5 / 1 | 0 / 0 | 8 |

The duplicate `a` is discarded from the resulting HTML tree but remains in the
attempted-attribute counters because the parser observed and budgeted it.
Callback-only trace observation reports emitted event count while retaining
zero canonical trace bytes; summary/events modes report the exact canonical
UTF-8 byte total already enforced by trace budgets.

## Encoding and decoded source

Byte and one-byte-chunk stream fixtures preserve each HTML encoding evidence
branch:

| Evidence | Selected encoding | Fixture result |
| --- | --- | --- |
| UTF-8 BOM overriding a legacy meta declaration | `utf-8` | `source: "bom"` |
| `<meta charset=windows-1252>` | `windows-1252` | `source: "meta"` |
| No BOM, transport label, or meta declaration | `windows-1252` | `source: "default"` |
| Explicit Windows-1252 transport label | `windows-1252` | `source: "transport"` |

For byte `0x80`, both byte and stream results retain `<p>€</p>` when requested,
and their tree text, span offsets, and serialization all refer to that same
decoded string. Text input is reported as already decoded with a null encoding
name and null transport length. Text and fragment APIs reject transport-only
configuration instead of silently ignoring it.

## Patch ownership

Patch planning requires the exact registered result object, retained source,
and captured spans. It reads `document.tree` and never reparses a caller-provided
string. Patch application requires the exact plan object and the same exact
document object. Tests cover source-less results, missing spans, cloned/forged
documents, cloned plans, and cross-document plans through distinct structured
failure reasons. Parser-owned trees and their nested nodes, arrays, spans,
attributes, and diagnostics are frozen so registration cannot be bypassed by
mutating a node or source span after parsing.

This identity rule prevents coincident node IDs from one parse from targeting a
different source, which the baseline allowed.

## Verification

```bash
npm run check:fast
npm run docs:lint:jsr
npm run docs:test:jsr
npm run eval:ci
npm run pack:check
```

All manifest versions remain `0.1.1`.
