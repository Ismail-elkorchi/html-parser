# Options

## Common parse APIs (`parse`, `parseBytes`, `parseFragment`)

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
- Type: `ParseBudgetOptions` on Node/npm; `ParseBudgets` on JSR
- Default: all limits unset (no budget enforcement unless specified)
- Every limit is inclusive. A limit must be a finite, non-negative safe integer;
  zero is valid and absence disables that limit.
- Option objects and `budgets` are closed schemas. Unknown keys and invalid
  values throw `HtmlConfigurationError` before parsing or stream-reader
  acquisition.

| Key | Unit and enforcement point |
| --- | --- |
| `maxInputBytes` | UTF-8 bytes for text input; transport bytes for byte/stream input, checked before parsing or after each stream read |
| `maxDecodedUtf8Bytes` | UTF-8 bytes produced by decoding, checked before retaining each fixed-size decoded chunk |
| `maxNodes` | public root plus every input/recovery node allocation; fixed fragment scaffolding is excluded |
| `maxDepth` | tree depth with the public document or fragment root at depth 1; reparented subtrees are rechecked |
| `maxParseErrors` | emitted parse errors, stopped at the first excess error |
| `maxAttributesPerElement` | attempted start-tag attributes, including duplicates discarded later |
| `maxAttributeBytes` | UTF-8 bytes in attempted normalized names and decoded values on one start tag; markup syntax is excluded |
| `maxTraceEvents` | retained trace events when `trace` is enabled |
| `maxTraceBytes` | current serialized trace-size counter when `trace` is enabled |
| `maxTimeMs` | elapsed monotonic milliseconds shared across decode, parse, conversion, and trace work |

Hard-budget failures report deterministic `actual: limit + 1`, the first
unavailable unit.

### `signal`
- Type: `AbortSignal`
- Default: unset
- Cancels decode, parse, conversion, and trace work. An already-aborted signal
  fails before work starts. `HtmlAbortError.cause` is the exact signal reason.

## `parseStream(stream, options?)`

- Type: `ParseStreamOptions`; its `budgets` field is
  `ParseStreamBudgetOptions` on Node/npm and `ParseStreamBudgets` on JSR.
- It accepts all common parse controls plus `maxEncodingPrescanBytes`.
- `maxEncodingPrescanBytes` is an inclusive retention cap in transport bytes,
  not a hard budget that throws on later stream data. Zero disables prescan
  retention. When absent, the effective implementation cap is 16,384 bytes;
  larger configured values do not raise that implementation cap.
- With tracing enabled, the `stream` event reports `bytesRead`, the observed
  `encodingPrescanBytes` high-water mark, and effective
  `encodingPrescanLimitBytes`.
- The operation reads through EOF, retains decoded chunk strings and their
  joined source text, and then builds the document. Its promise cannot resolve
  before EOF.
- Success consumes through EOF and releases the reader lock before resolution.
  A read/decode failure before EOF initiates cancellation with the original
  error and releases the lock; a cancellation failure does not replace or delay
  that failure. Parse or tokenization failures happen after EOF, when the reader
  has already been released.

## `tokenizeByteStreamEager(stream, options?)`

- Return type: `Promise<readonly Token[]>` on Node/npm and
  `Promise<readonly HtmlToken[]>` on JSR.
- The complete byte stream is decoded and tokenized before the promise resolves;
  no token is observable before EOF.

### `options.transportEncodingLabel`
- Type: `string`
- Default: unset

### `options.budgets`
- Type: `TokenizeByteStreamEagerBudgets`
- Relevant keys: `maxInputBytes`, `maxEncodingPrescanBytes`,
  `maxDecodedUtf8Bytes`, `maxParseErrors`, `maxAttributesPerElement`,
  `maxAttributeBytes`, and `maxTimeMs`.
- `maxInputBytes` limits the complete byte stream.
- `maxEncodingPrescanBytes` has the same non-throwing prescan-retention semantics
  and 16,384-byte implementation maximum as `parseStream()`.

### `options.signal`
- Type: `AbortSignal`
- Cancels stream decode and tokenization. Success or failure releases the reader
  lock before the returned promise settles.

## Serialization, traversal, and extraction operation controls

`serialize`, `walk`, `walkElements`, `textContent`, `findById`,
`findAllByTagName`, `findAllByAttr`, and `outline` accept `OperationOptions`.
`chunk` accepts its sizing options plus the same controls. Node/npm visible-text
functions and JSR `visibleText` accept these controls through
`VisibleTextOptions`.

- `maxTimeMs`: inclusive monotonic deadline for that operation.
- `signal`: cooperative cancellation signal for that operation.

Each call owns a new operation context; a completed parse deadline is never
reused for later traversal or serialization.

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
