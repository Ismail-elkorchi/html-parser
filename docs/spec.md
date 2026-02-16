# Parser specification (public API)

## Public functions
- `parse(html, options)`
- `parseBytes(bytes, options)`
- `parseFragment(html, contextTagName, options)`
- `parseStream(stream, options)`
- `tokenizeStream(stream, options)`
- `serialize(tree, options)`
- `computePatch(originalHtml, edits)`
- `applyPatchPlan(originalHtml, plan)`
- `walk(tree, visitor)`
- `walkElements(tree, visitor)`
- `textContent(node)`
- `visibleText(nodeOrTree, options?)`
- `visibleTextTokens(nodeOrTree, options?)`
- `findById(tree, id)`
- `findAllByTagName(tree, tagName)` (iterator)
- `findAllByAttr(tree, name, value?)` (iterator)
- `outline(tree, options)`
- `chunk(tree, options)`

`computePatch` edit algebra:
- `{ kind: "removeNode", target }`
- `{ kind: "replaceText", target, value }`
- `{ kind: "setAttr", target, name, value }`
- `{ kind: "removeAttr", target, name }`
- `{ kind: "insertHtmlBefore", target, html }`
- `{ kind: "insertHtmlAfter", target, html }`

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
- `chunk.maxChars`: `8192`
- `chunk.maxNodes`: `256`
- `chunk.maxBytes`: unlimited
- `visibleText.skipHiddenSubtrees`: `true`
- `visibleText.includeControlValues`: `true`
- `visibleText.trim`: `true`

`tokenizeStream` yields token kinds:
- `startTag`
- `endTag`
- `chars`
- `comment`
- `doctype`
- `eof`

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
- Traversal/search helpers iterate in deterministic pre-order document order.
- `visibleText` and `visibleTextTokens` are stable for equal input + options.

## Visible text contract
- Normative contract: `docs/visible-text.md`.
- Scope:
  - deterministic text extraction for agent workflows
  - explicit structural breaks (`br`, `p`, table row/cell, block boundaries)
- Non-goal:
  - browser layout-equivalent `innerText` behavior

## Span precision
- Node and attribute spans are populated only when `captureSpans: true`.
- Spans are source offsets from parse5 location metadata.
- Implied nodes added by tree construction (for example inferred wrappers) may not expose spans.
- Patch planning requires spans on targeted nodes and attribute edits require attribute spans.
- If spans are missing or edits overlap, `computePatch` throws `PatchPlanningError` with a structured payload.

## Budgets contract
- Budget violations throw `BudgetExceededError`.
- Error payload schema:
  - `code`: `BUDGET_EXCEEDED`
  - `budget`: `maxInputBytes` | `maxBufferedBytes` | `maxNodes` | `maxDepth` | `maxTraceEvents` | `maxTraceBytes` | `maxTimeMs`
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
  - `insertionModeTransition`
  - `tree-mutation`
  - `parseError`
  - `budget`
  - `stream`

Stable event shapes:
- `decode`:
  - `source`: `input` | `sniff`
  - `encoding`: string
  - `sniffSource`: `input` | `bom` | `transport` | `meta` | `default`
- `token`:
  - `count`: number
- `insertionModeTransition`:
  - `fromMode`: parser insertion mode before transition
  - `toMode`: parser insertion mode after transition
  - `tokenContext`:
    - `type`: parser token type summary or `null`
    - `tagName`: token tag name when available, otherwise `null`
    - `startOffset`: source offset when available, otherwise `null`
    - `endOffset`: source offset when available, otherwise `null`
- `tree-mutation`:
  - `nodeCount`: number
  - `errorCount`: number
- `parseError`:
  - `parseErrorId`: parser error identifier string
  - `startOffset`: number | null
  - `endOffset`: number | null
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
