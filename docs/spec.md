# Parser specification (public API)

## Public functions
- `parse(html, options)`
- `parseBytes(bytes, options)`
- `parseFragment(html, contextTagName, options)`
- `parseStream(stream, options)`
- `serialize(tree, options)`
- `outline(tree, options)`
- `chunk(tree, options)`

## Options and defaults
- `includeSpans`: `false`
- `trace`: `false`
- `transportEncodingLabel`: undefined
- `budgets.maxInputBytes`: undefined
- `budgets.maxBufferedBytes`: undefined
- `budgets.maxNodes`: undefined
- `budgets.maxDepth`: undefined
- `budgets.maxTraceEvents`: undefined
- `budgets.maxTraceBytes`: undefined
- `budgets.maxTimeMs`: undefined

`parseBytes` decoding order:
1) BOM detection
2) transport override label (if provided)
3) bounded `<meta charset>` prescan
4) default fallback (`windows-1252`)

## Determinism contract
- Node IDs are assigned with deterministic pre-order incremental numbering.
- Attribute ordering is stable by lexical attribute name.
- For equal input + options, API output is byte-for-byte stable.

## Budgets contract
- Budget violations throw `BudgetExceededError`.
- Error payload schema:
  - `code`: `BUDGET_EXCEEDED`
  - `budget`: `maxInputBytes` | `maxNodes` | `maxTraceEvents`
  - `limit`: configured threshold
  - `actual`: observed value

## Trace schema
When `trace: true`, trace output is bounded by `budgets.maxTraceEvents`.
Each event:
- `seq`: monotonic sequence number
- `stage`: `decode` | `tokenize` | `tree` | `fragment` | `stream` | `serialize`
- `detail`: stable descriptive string

## Foreign content scope (v1)
- Fragment parsing is namespace-aware for HTML, SVG, and MathML context tags.
- For SVG and MathML contexts, fragment roots are represented with a deterministic prefixed tag name:
  - `svg:<context>`
  - `mathml:<context>`
- Full HTML insertion-mode parity inside foreign content is not complete in v1 and is tracked as fixture debt.
