# Parse Streaming Input

Goal: parse chunked HTML from a network or file stream.

```ts
import {
  parseStream,
  tokenizeByteStreamEager,
  type ParseStreamOptions
} from "@ismail-elkorchi/html-parser";

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("<section><p>"));
    controller.enqueue(new TextEncoder().encode("streamed content"));
    controller.enqueue(new TextEncoder().encode("</p></section>"));
    controller.close();
  }
});

const options = {
  budgets: {
    maxInputBytes: 8_192,
    maxEncodingPrescanBytes: 512,
    maxDecodedUtf8Bytes: 8_192,
    maxNodes: 512,
    maxDepth: 64
  }
} satisfies ParseStreamOptions;

const tree = await parseStream(stream, options);

console.log(tree.kind, tree.children.length);
```

Expected output:
- A deterministic `document` tree even when bytes arrive in multiple chunks.

`maxInputBytes` limits the complete transport payload.
`maxEncodingPrescanBytes` limits only the transport prefix retained for encoding
sniffing and never turns the remainder into an overrun. Zero disables prescan
retention. The default and implementation maximum are 16,384 bytes, so a larger
configured value does not increase retention. `maxDecodedUtf8Bytes` is the
separate hard limit for decoded output.

`parseStream()` consumes through EOF, joins the complete decoded document, and
then parses it. It is transport-streaming input, not an incremental tree API.
The reader lock is released before its promise settles.

When a complete token collection is more useful than a tree, use the explicitly
eager tokenizer:

```ts
import { tokenizeByteStreamEager } from "@ismail-elkorchi/html-parser";

const tokenStream = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("<p>all tokens</p>"));
    controller.close();
  }
});

const tokens = await tokenizeByteStreamEager(tokenStream, {
  budgets: {
    maxInputBytes: 1_024,
    maxEncodingPrescanBytes: 256,
    maxDecodedUtf8Bytes: 1_024
  }
});
console.log(tokens.map((token) => token.kind));
```

`tokenizeByteStreamEager()` returns `Promise<readonly Token[]>`. It reads and
decodes through EOF before tokenization completes, so no token is observable
before EOF. A truly incremental tokenizer or tree builder is not part of this
API.
