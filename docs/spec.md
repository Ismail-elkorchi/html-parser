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
- `budgets.maxNodes`: undefined
- `budgets.maxTraceEvents`: undefined

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
- `stage`: `decode` | `tokenize` | `tree` | `serialize`
- `detail`: stable descriptive string
