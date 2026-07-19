# Streams and encoding

`parseStream()` accepts a `ReadableStream<Uint8Array>`. It limits transport and
decoded data while reading, releases the reader lock on every completion path,
and returns the same `ParsedDocument` shape as the other full-document entry
points.

```ts
import { parseStream } from "@ismail-elkorchi/html-parser";

const stream = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("<p>streamed</p>"));
    controller.close();
  }
});

const document = await parseStream(stream, {
  sourceRetention: "text",
  budgets: {
    maxInputBytes: 4_096,
    maxEncodingPrescanBytes: 1_024,
    maxDecodedUtf8Bytes: 4_096,
    maxNodes: 256,
    maxTimeMs: 250
  }
});

console.log(document.sourceText, document.metadata.encoding);
```

## Lifecycle

The current implementation streams transport reads and decoding but buffers
the complete decoded document before tree construction. The promise therefore
cannot resolve before EOF. This is a lifecycle guarantee, not a claim that tree
construction is incremental.

On success, the stream is read through EOF and its reader lock is released
before resolution. A read or decode failure initiates cancellation with the
original error and releases the lock; cancellation failure does not replace
the original failure. Parsing begins after EOF, when the reader is no longer
held.

`tokenizeByteStreamEager()` has the same eager boundary: it returns all tokens
after EOF and does not expose tokens progressively.

## Encoding selection

Byte and stream entry points use the same HTML sniffing and decoding pipeline.
`metadata.encoding.source` reports `"bom"`, `"transport"`, `"meta"`, or
`"default"`; `metadata.encoding.name` reports the selected WHATWG encoding.

`maxEncodingPrescanBytes` limits how much transport prefix is retained for
encoding prescan. It is not a total-input budget and later bytes do not make it
throw. The implementation never retains more than 16,384 bytes for prescan,
even when a larger value is configured. Use `maxInputBytes` for total transport
bytes and `maxDecodedUtf8Bytes` for decoded UTF-8 size.

## Cancellation and stream failures

Pass an `AbortSignal` for request-scoped cancellation. An already-aborted
signal fails before acquiring the reader. Mid-read cancellation throws
`HtmlAbortError`; reader acquisition and read failures throw
`HtmlStreamReadError` with the original error as `cause`.

Do not reuse a disturbed or locked stream. If two consumers need the body,
make that ownership decision before calling the parser.
