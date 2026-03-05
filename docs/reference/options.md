# Options

## `parse`, `parseBytes`, `parseFragment`, `parseStream`

### `captureSpans`
- Type: `boolean`
- Default: `false`
- Adds source-range spans to emitted nodes and attributes.

### `trace`
- Type: `boolean`
- Default: `false`
- Enables structured trace events for diagnostics.

### `budgets`
- Type: `object`
- Purpose: upper-bounds resource usage.

Supported budget keys:
- `maxInputBytes`
- `maxBufferedBytes` (streaming)
- `maxNodes`
- `maxDepth`
- `maxAttributesPerElement`
- `maxTraceEvents`
- `maxTraceBytes`

## `tokenizeStream(stream, options?)`

### `options.budgets`
- `maxInputBytes`
- `maxBufferedBytes`

## `visibleText(nodeOrTree, options?)`

### `preserveLineBreaks`
- Type: `boolean`
- Default: `true`

### `collapseWhitespace`
- Type: `boolean`
- Default: `true`

## Patch APIs

### `computePatch(originalHtml, edits)`
- Generates a deterministic patch plan.
- Throws `PatchPlanningError` for invalid targets or unsupported edits.

### `applyPatchPlan(originalHtml, plan)`
- Applies a previously computed patch plan.

## Related
- [API overview](./api-overview.md)
- [Error model](./error-model.md)
