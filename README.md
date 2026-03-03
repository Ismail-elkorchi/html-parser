# @ismail-elkorchi/html-parser

Deterministic HTML parsing for automation pipelines that need stable, auditable output across Node, Deno, Bun, and modern browsers.

## Install

```bash
npm install @ismail-elkorchi/html-parser
```

```ts
import { parse } from "jsr:@ismail-elkorchi/html-parser";
```

## Success Path

```ts
import { parse, parseStream, serialize, visibleText } from "@ismail-elkorchi/html-parser";

const input = [
  "<article>",
  "  <h1>Release Notes</h1>",
  "  <p>Deterministic output matters.</p>",
  "</article>"
].join("\n");

const parsed = parse(input, {
  budgets: {
    maxInputBytes: 4096,
    maxNodes: 256,
    maxDepth: 32
  }
});

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("<section><p>"));
    controller.enqueue(new TextEncoder().encode("stream path"));
    controller.enqueue(new TextEncoder().encode("</p></section>"));
    controller.close();
  }
});

const streamed = await parseStream(stream, {
  budgets: { maxInputBytes: 4096, maxBufferedBytes: 256, maxNodes: 256 }
});

console.log(visibleText(parsed).trim());
console.log(serialize(streamed));
```

Runnable examples:

```bash
npm run examples:run
```

## API and Options

- [Options and budget reference](./docs/reference/options.md)
- [Documentation index](./docs/index.md)

## When To Use

- You need deterministic parse/serialize behavior for repeatable automation.
- You need bounded parse execution using explicit budget controls.
- You need the same runtime behavior across Node, Deno, Bun, and browser smoke paths.

## When Not To Use

- You need sanitization for untrusted HTML rendering.
- You need full browser runtime semantics.
- You need dynamic script execution in parsed content.

## Security Note

Parsing is not sanitization. If you render untrusted HTML, apply an explicit sanitization step before output, storage, or UI rendering. See [SECURITY.md](./SECURITY.md).

## Release Validation

```bash
npm run check:fast
npm run eval:release
npm run docs:lint:jsr
npm run docs:test:jsr
```
