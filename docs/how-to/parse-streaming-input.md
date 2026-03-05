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
