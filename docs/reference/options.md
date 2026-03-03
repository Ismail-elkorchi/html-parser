# Options Reference

## `parse(input, options?)`

### `options.captureSpans`
- Type: `boolean`
- Default: `false`
- Enables source span metadata on emitted nodes.

### `options.trace`
- Type: `boolean`
- Default: `false`
- Emits parser trace events for diagnostics and replay checks.

### `options.budgets`
- Type: `object`
- Enforces deterministic execution limits.

Budget keys:
- `maxInputBytes`: maximum accepted input bytes.
- `maxBufferedBytes`: maximum buffered stream bytes.
- `maxNodes`: maximum emitted node count.
- `maxDepth`: maximum tree depth.
- `maxAttributesPerElement`: element attribute upper bound.
- `maxTraceEvents`: maximum emitted trace events.
- `maxTraceBytes`: serialized trace byte ceiling.

Exceeding a limit throws `BudgetExceededError`.

## `parseBytes(input, options?)`

Same options as `parse`, with encoding sniffing before tokenization.

## `parseStream(stream, options?)`

Same options as `parse`, with explicit stream buffering control through `budgets.maxBufferedBytes`.

## `tokenizeStream(stream, options?)`

### `options.budgets`
- `maxInputBytes`
- `maxBufferedBytes`

## `visibleText(nodeOrTree, options?)`

### `options.preserveLineBreaks`
- Type: `boolean`
- Default: `true`
- Keeps deterministic line-break boundaries in extracted text.

### `options.collapseWhitespace`
- Type: `boolean`
- Default: `true`
- Collapses repeated whitespace in non-preformatted contexts.

## `computePatch(originalHtml, edits)`

Deterministic patch planning over parsed structure. Throws `PatchPlanningError` for invalid targets or unsupported edit sequences.

## Related

- [API overview](./api-overview.md)
- [Acceptance gates](../acceptance-gates.md)
