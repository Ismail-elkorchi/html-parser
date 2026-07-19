# Data Model

## Parse Output Shape

`parse` and `parseBytes` return a `DocumentTree`:
- `kind: "document"`
- `children: HtmlNode[]`
- `errors: ParseError[]`
- optional `trace: TraceResult`, containing either a constant-shape summary or
  that summary plus an immutable event sequence

`parseFragment` returns a `FragmentTree` with the same structure but `kind: "fragment"`.

The trace summary's `tokenCount` and the retained token event report the number
of logical tokens emitted to the tree builder, coalescing adjacent character
chunks and including EOF. Fragment token counts reflect the supplied fragment
context.

## Core Node Types

`HtmlNode` is a tagged union:
- `element`: `tagName`, `attributes`, `children`
- `text`: `value`
- `comment`: `value`
- `doctype`: name/public/system fields

When spans are enabled, nodes expose `span` and `spanProvenance`.

## Traversal

Use traversal helpers from the Node/npm surface (`walk`, `walkElements`, `findById`, `findAllByTagName`, `findAllByAttr`) when you need structural queries.

For JSR-only workflows, iterate over `children` recursively using node `kind` checks.

## Serialization

`serialize(documentOrNode)` emits normalized HTML text from a parsed tree or node subtree.

## Errors And Budgets

- Non-fatal parser issues are returned in `errors` with stable `parseErrorId` values.
- Budget violations throw `HtmlBudgetExceededError`.
- Invalid options and required arguments throw `HtmlConfigurationError`.
- Patch planning/application failures throw `HtmlPatchPlanningError`.
- Stream acquisition/read failures throw `HtmlStreamReadError` with the
  original failure as `cause`.

Budget controls live in `ParseOptions.budgets` and hard-stop input/decoded
bytes, parser node/depth/error/attribute allocation, trace retention, and
elapsed work at the first unavailable unit.
