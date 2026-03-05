# Data Model

## Parse Output Shape

`parse` and `parseBytes` return a `DocumentTree`:
- `kind: "document"`
- `children: HtmlNode[]`
- `errors: ParseError[]`
- optional `trace: TraceEvent[]`

`parseFragment` returns a `FragmentTree` with the same structure but `kind: "fragment"`.

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
- Budget violations throw `BudgetExceededError`.
- Patch planning failures throw `PatchPlanningError`.

Budget controls live in `ParseOptions.budgets` and bound input bytes, nodes, depth, trace size, and parse time.
