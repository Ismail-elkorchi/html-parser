# Options

## Common parse controls

### `captureSpans`
- Type: `boolean`
- Default: `false`
- Includes source spans on nodes and attributes.

### `trace`
- Type: `"none" | "summary" | "events"`
- Default: `"none"`
- `"summary"` returns deterministic constant-shape counters without retaining
  individual events. `"events"` returns the same summary plus the immutable
  event sequence. `"none"` omits `tree.trace`.
- Token events count logical context-aware tokens consumed by tree construction,
  coalescing adjacent character chunks and including EOF.

### `onTraceEvent`
- Type: `(event: TraceEvent) => void`
- Default: unset
- Synchronously receives each deeply immutable event in sequence order without
  requiring returned event retention. Exceptions escape unchanged and stop the
  parse. Cancellation is checked before and after each callback. A callback may
  start an independent nested parse.

### `budgets`
- Type: `ParseBudgetOptions` on Node/npm; `ParseBudgets` on JSR
- Default: all limits unset (no budget enforcement unless specified)
- Every limit is inclusive. A limit must be a finite, non-negative safe integer;
  zero is valid and absence disables that limit.
- Option objects and `budgets` are closed schemas. Unknown keys and invalid
  values throw `HtmlConfigurationError` before parsing or stream-reader
  acquisition.
- Accepted option fields and nested budget values are read once and retained in
  an immutable operation snapshot before work begins. `AbortSignal` state
  remains live so cancellation can still occur during work.

| Key | Unit and enforcement point |
| --- | --- |
| `maxInputBytes` | UTF-8 bytes for text input; transport bytes for byte/stream input, checked before parsing or after each stream read |
| `maxDecodedUtf8Bytes` | UTF-8 bytes produced by decoding, checked before retaining each fixed-size decoded chunk |
| `maxNodes` | public root plus every input/recovery node allocation; fixed fragment scaffolding is excluded |
| `maxDepth` | tree depth with the public document or fragment root at depth 1; reparented subtrees are rechecked |
| `maxParseErrors` | emitted parse errors, stopped at the first excess error |
| `maxAttributesPerElement` | attempted start-tag attributes, including duplicates discarded later |
| `maxAttributeBytes` | UTF-8 bytes in attempted normalized names and decoded values on one start tag; markup syntax is excluded |
| `maxTraceEvents` | retained trace events; valid only with `trace: "events"` |
| `maxTraceBytes` | UTF-8 bytes of each retained event's canonical `JSON.stringify` form, with no delimiter; valid only with `trace: "events"` |
| `maxTimeMs` | elapsed monotonic milliseconds shared across decode, parse, conversion, and trace work |

Hard-budget failures report deterministic `actual: limit + 1`, the first
unavailable unit.

### `signal`
- Type: `AbortSignal`
- Default: unset
- Cancels decode, parse, conversion, and trace work. An already-aborted signal
  fails before work starts. `HtmlAbortError.cause` is the exact signal reason.

## Full-document results and source retention

`parse`, `parseBytes`, and `parseStream` return
`{ tree, sourceText, metadata }`. `tree` is the parsed `DocumentTree`.
`sourceText` is always present and is `null` unless `sourceRetention: "text"`
is selected. In that mode it is the exact decoded text whose UTF-16 offsets
are used by captured spans.

### `sourceRetention`
- Type: `"none" | "text"`
- Default: `"none"`
- Accepted by full-document entrypoints only. `parseFragment` rejects it.

`metadata` reports the input kind, transport byte length, encoding evidence,
and a `resourceUsage` object. Resource usage includes input bytes, decoded
UTF-8 bytes and UTF-16 code units, all node allocations counted by `maxNodes`,
highest parser-assigned depth, emitted parse errors, attempted attributes and
their UTF-8 bytes, encoding-prescan high-water bytes, and observable trace
event/byte totals.

Text input is already decoded. `parse()` therefore rejects
`transportEncodingLabel` and reports
`{ name: null, source: "already-decoded" }`. `parseBytes()` and
`parseStream()` accept `transportEncodingLabel` and report the encoding choice
from the same sniff/decode pipeline that built the tree.

```ts
import { parseBytes, parseStream } from "@ismail-elkorchi/html-parser";

// A browser session can consume the parser-owned decoded source without
// teeing and independently decoding the response.
declare const responseBody: ReadableStream<Uint8Array>;
const browserDocument = await parseStream(responseBody, {
  sourceRetention: "text"
});
console.log(browserDocument.sourceText, browserDocument.metadata.encoding);

// A crawler with complete response bytes can use the same result shape.
declare const responseBytes: Uint8Array;
const crawlerDocument = parseBytes(responseBytes, {
  sourceRetention: "text"
});
console.log(crawlerDocument.tree.errors, crawlerDocument.metadata.resourceUsage);
```

## `parseStream(stream, options?)`

- Type: `ParseStreamOptions`; its `budgets` field is
  `ParseStreamBudgetOptions` on Node/npm and `ParseStreamBudgets` on JSR.
- It accepts all common parse controls plus `maxEncodingPrescanBytes`.
- `maxEncodingPrescanBytes` is an inclusive retention cap in transport bytes,
  not a hard budget that throws on later stream data. Zero disables prescan
  retention. When absent, the effective implementation cap is 16,384 bytes;
  larger configured values do not raise that implementation cap.
- In `"events"` mode (or through `onTraceEvent`), the `stream` event reports `bytesRead`, the observed
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

## Trace result shape

`trace: "summary"` returns `{ mode: "summary", summary }`. `trace: "events"`
returns `{ mode: "events", summary, events }`. The summary includes token,
node, depth, error, encoding, input/decode byte, stream-prescan, event-count,
canonical event-byte, and sorted event-kind fields. Summary shape is fixed;
only numeric/string values and the finite event-kind set vary with input.

Trace retention budgets are configuration errors unless the selected mode is
`"events"`. `onTraceEvent` alone does not retain events and therefore does not
enable those budgets.

```ts
import { parse, type TraceEvent } from "@ismail-elkorchi/html-parser";

const observedKinds = new Set<TraceEvent["kind"]>();
const document = parse("<main><p>indexed</p></main>", {
  trace: "summary",
  onTraceEvent(event) {
    observedKinds.add(event.kind);
  }
});

if (document.tree.trace?.mode === "summary") {
  console.log(
    document.tree.trace.summary.tokenCount,
    document.tree.trace.summary.eventKinds
  );
}
```

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

### `computePatch(document, edits)`
- Accepts the exact `ParsedDocument` returned by a full-document parse with
  both `captureSpans: true` and `sourceRetention: "text"`.
- Generates deterministic patch steps directly from that tree and source; it
  never reparses.
- Rejects forged/cloned results, source-less results, missing span capture,
  invalid targets, and non-input spans with `HtmlPatchPlanningError`.

### `applyPatchPlan(document, plan)`
- Applies a computed plan only to the exact `ParsedDocument` object that
  produced it. A cloned plan or a plan from another parse is rejected.

## Related
- [API overview](./api-overview.md)
- [Data model](./data-model.md)
- [Error model](./error-model.md)
