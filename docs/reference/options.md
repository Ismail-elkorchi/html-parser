# Options

## Parse APIs (`parse`, `parseBytes`, `parseFragment`, `parseStream`)

### `captureSpans`
- Type: `boolean`
- Default: `false`
- Includes source spans on nodes and attributes.

### `trace`
- Type: `boolean`
- Default: `false`
- Adds structured trace events for decode/token/parse/budget stages.
- Token events count logical context-aware tokens consumed by tree construction,
  coalescing adjacent character chunks and including EOF.

### `transportEncodingLabel`
- Type: `string`
- Default: unset
- Optional transport hint used by byte parsing paths.

### `budgets`
- Type: `ParseBudgets`
- Default: all limits unset (no budget enforcement unless specified)
- Supported keys:
  - `maxInputBytes`
  - `maxBufferedBytes` (maximum encoding-prescan bytes retained by stream decode)
  - `maxNodes`
  - `maxDepth`
  - `maxTraceEvents`
  - `maxTraceBytes`
  - `maxTimeMs`

## `tokenizeStream(stream, options?)`

### `options.transportEncodingLabel`
- Type: `string`
- Default: unset

### `options.budgets`
- Type: `ParseBudgets`
- Relevant keys: `maxInputBytes`, `maxBufferedBytes`, `maxTimeMs`
- `maxInputBytes` limits the complete byte stream.
- `maxBufferedBytes` caps only the encoding prescan; subsequent bytes are decoded
  without being retained in that buffer.

## `visibleText(nodeOrTree, options?)`

### `skipHiddenSubtrees`
- Type: `boolean`
- Default: `true`
- Skips hidden subtree content (`hidden`, `aria-hidden`, etc.).

### `includeControlValues`
- Type: `boolean`
- Default: `true`
- Includes values from controls like `input` and `textarea`.

### `includeAccessibleNameFallback`
- Type: `boolean`
- Default: `false`
- Opt-in fallback for specific accessibility-name sources.

### `trim`
- Type: `boolean`
- Default: `true`
- Trims final extracted output.

## Node/npm-only patch APIs

### `computePatch(originalHtml, edits)`
- Generates deterministic patch steps over input spans.
- Throws `HtmlPatchPlanningError` for invalid targets, non-input spans, or
  invalid plan steps.

### `applyPatchPlan(originalHtml, plan)`
- Applies a computed patch plan to produce final HTML.

## Related
- [API overview](./api-overview.md)
- [Data model](./data-model.md)
- [Error model](./error-model.md)
