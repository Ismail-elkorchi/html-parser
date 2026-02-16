# Parser specification (public API)

## Public functions
- `parse(html, options)`
- `parseBytes(bytes, options)`
- `parseFragment(html, contextTagName, options)`
- `parseStream(stream, options)`
- `serialize(tree, options)`
- `computePatch(originalHtml, edits)`
- `applyPatchPlan(originalHtml, plan)`
- `outline(tree, options)`
- `chunk(tree, options)`

## Options and defaults
- `captureSpans`: `false`
- `includeSpans`: `false` (legacy alias for `captureSpans`)
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

`parseStream` decoding order:
1) Read incrementally from `ReadableStream<Uint8Array>`
2) Buffer up to the prescan window (`16384` bytes) for deterministic encoding sniff parity
3) Decode remaining chunks with `TextDecoder(..., { stream: true })`
4) Parse decoded text with the same tree pipeline as `parse`

## Determinism contract
- Node IDs are assigned with deterministic pre-order incremental numbering.
- Attribute ordering is stable by input order after duplicate-name normalization.
- For equal input + options, API output is byte-for-byte stable.

## Span precision
- Node and attribute spans are populated only when `captureSpans: true`.
- Spans are source offsets from parse5 location metadata.
- Implied nodes added by tree construction (for example inferred wrappers) may not expose spans.
- Patch planning requires spans on targeted nodes.

## Budgets contract
- Budget violations throw `BudgetExceededError`.
- Error payload schema:
  - `code`: `BUDGET_EXCEEDED`
  - `budget`: `maxInputBytes` | `maxNodes` | `maxTraceEvents`
  - `limit`: configured threshold
  - `actual`: observed value

## Trace schema
When `trace: true`, trace output is bounded by:
- `budgets.maxTraceEvents`
- `budgets.maxTraceBytes`

Each event is a structured object with:
- `seq`: monotonic sequence number
- `kind`: one of:
  - `decode`
  - `token`
  - `insertion-mode`
  - `tree-mutation`
  - `parse-error`
  - `budget`
  - `stream`

Stable event shapes:
- `decode`:
  - `source`: `input` | `sniff`
  - `encoding`: string
  - `sniffSource`: `input` | `bom` | `transport` | `meta` | `default`
- `token`:
  - `count`: number
- `insertion-mode`:
  - `mode`: `document-start` | `fragment-start` | `after-tree`
- `tree-mutation`:
  - `nodeCount`: number
  - `errorCount`: number
- `parse-error`:
  - `code`: string
- `budget`:
  - `budget`: budget key
  - `limit`: number | null
  - `actual`: number
  - `status`: `ok` | `exceeded`
- `stream`:
  - `bytesRead`: number

## Foreign content scope (v1)
- Fragment parsing is namespace-aware for HTML, SVG, and MathML context tags.
- For SVG and MathML contexts, fragment roots are represented with a deterministic prefixed tag name:
  - `svg:<context>`
  - `mathml:<context>`
- Full HTML insertion-mode parity inside foreign content is not complete in v1 and is tracked as fixture debt.
