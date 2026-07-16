# Parse Streaming Input

Goal: parse chunked HTML from a network or file stream.

```ts
import { parseStream } from "@ismail-elkorchi/html-parser";

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("<section><p>"));
    controller.enqueue(new TextEncoder().encode("streamed content"));
    controller.enqueue(new TextEncoder().encode("</p></section>"));
    controller.close();
  }
});

const tree = await parseStream(stream, {
  budgets: {
    maxInputBytes: 8_192,
    maxBufferedBytes: 512,
    maxNodes: 512,
    maxDepth: 64
  }
});

console.log(tree.kind, tree.children.length);
```

Expected output:
- A deterministic `document` tree even when bytes arrive in multiple chunks.

`maxInputBytes` limits the complete transport payload. `maxBufferedBytes` limits
the prefix retained for encoding sniffing; it does not depend on how the producer
chunks the same bytes.
