# Performance Characteristics

The parser is optimized for deterministic behavior, predictable memory bounds, and stable results across runtimes.

Key characteristics:
- A single parse5 pass with parser-phase node, depth, error, and attribute hard
  stops.
- Byte decoding checks decoded UTF-8 output before retaining fixed-size chunks.
- Stream encoding-prescan retention is capped independently from input and
  decoded-output limits. The effective cap is the smaller of
  `maxEncodingPrescanBytes` and the 16,384-byte implementation maximum.
- `parseStream()` is transport streaming with a buffered document parse;
  `tokenizeByteStreamEager()` resolves one complete token collection. Neither
  exposes a result before EOF.
- Monotonic deadline and abort checkpoints cover decoding, tree construction,
  public conversion, serialization, traversal, and extraction. A stream
  deadline also interrupts a pending read.
- Deterministic serialization and traversal helpers.
- Tree conversion, metrics, normalization, serialization, traversal, text and
  provenance extraction, outline, queries, patch indexing, and chunk counting
  use explicit stacks. Accepted parser depths are therefore independent of the
  JavaScript engine's call-stack limit.
- Trace events are accounted and appended in one pass. Summary mode retains
  fixed-shape counters instead of the event sequence; callback-only observation
  retains no public trace result.
- Full-document results expose successful resource observations collected by
  the owning decode/parser pass. Exact decoded source is retained only when
  `sourceRetention: "text"` is requested.

Benchmark and profiling commands:

```bash
npm run test:bench
npm run test:bench:stability
npm run test:bench:hard-budgets
```

The hard-budget benchmark runs node, attribute, parse-error, decoded-output,
and trace storms in isolated paired processes. It verifies exact first-failure values and
lower retained heap for bounded work; see the
[maintainer evidence](../maintainers/hard-budget-evidence.md).
Namespace/doctype fidelity and 5,000-level public-tree stack-safety evidence is
recorded in the [tree-model evidence](../maintainers/namespace-tree-model.md).

## Peak-memory model for byte streams

The parser owns the stream reader from acquisition until success or failure. An
upstream producer's queue is outside the parser's allocation accounting. During
a successful `parseStream()` call, these components can coexist:

1. up to the effective encoding-prescan cap in a transport-byte buffer;
2. decoded chunk strings whose aggregate UTF-8 size is bounded only when
   `maxDecodedUtf8Bytes` is configured;
3. the joined decoded source string (retained in the result only when requested);
4. the parse5 tree and its parser/tokenizer working state;
5. the public tree while conversion is in progress;
6. a trace event array only in `trace: "events"` mode (summary and callback-only
   modes do not retain it); and
7. any later serialization or extraction output owned by the caller's next
   operation.

Eager tokenization replaces the two tree components with the tokenizer's
internal token array and the returned public token array, which briefly coexist
during conversion. JavaScript engine string representation and garbage
collection timing are runtime-dependent, so transport, decoded UTF-8, nodes,
trace, and deadline controls should be configured together instead of treating
the prescan cap as a total-memory limit.

On success the parser reads through EOF and releases its reader lock before the
promise resolves. A read/decode failure before EOF initiates cancellation with
the original error, does not wait for a hostile cancellation promise, and
releases the lock. Tree construction and eager tokenization begin after that
release, so their failures do not retain or cancel an already-consumed reader. See the
[stream-buffering evidence](../maintainers/stream-buffering.md) for chunk,
EOF-observation, and retained-heap measurements.
