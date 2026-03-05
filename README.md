# @ismail-elkorchi/html-parser

Deterministic HTML parsing for automation pipelines that need stable, auditable output across Node, Deno, Bun, and modern browsers.

## When To Use

- You need deterministic parse/serialize behavior for repeatable automation.
- You need bounded parse execution using explicit budget controls.
- You need the same runtime behavior across Node, Deno, Bun, and browser smoke paths.

## When Not To Use

- You need sanitization for untrusted HTML rendering.
- You need full browser runtime semantics.
- You need dynamic script execution in parsed content.

## Install

```bash
npm install @ismail-elkorchi/html-parser
```

```bash
deno add jsr:@ismail-elkorchi/html-parser
```

## Quickstart

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

## Options and Config Reference

- [Options and budget reference](https://github.com/Ismail-elkorchi/html-parser/blob/main/docs/reference/options.md)
- [API overview](https://github.com/Ismail-elkorchi/html-parser/blob/main/docs/reference/api-overview.md)

## Error Handling and Gotchas

- Treat `BudgetExceededError` as an expected failure mode for untrusted or oversized input.
- Use `parseFragment()` when your input is intentionally partial HTML.
- `visibleText()` is for extraction and auditing, not security sanitization.
- Browser behavior can differ from full engine semantics by design; validate against your policy requirements.

## Compatibility Matrix

| Runtime | Status | Notes |
| --- | --- | --- |
| Node.js | ✅ | CI + smoke coverage |
| Deno | ✅ | CI + smoke coverage |
| Bun | ✅ | CI + smoke coverage |
| Browser (evergreen) | ✅ | Smoke-tested behavior |

## Security Notes

Parsing is not sanitization. If you render untrusted HTML, apply an explicit sanitization step before output, storage, or UI rendering. See [SECURITY.md](https://github.com/Ismail-elkorchi/html-parser/blob/main/SECURITY.md).

## Design Constraints / Non-goals

- Determinism and bounded execution are prioritized over browser-engine parity.
- The package does not execute scripts or emulate DOM side effects.
- The package does not enforce content policy or sanitization rules.

## Documentation Map

- [Tutorial](https://github.com/Ismail-elkorchi/html-parser/blob/main/docs/tutorial/first-parse.md)
- [How-to guides](https://github.com/Ismail-elkorchi/html-parser/tree/main/docs/how-to)
- [Reference](https://github.com/Ismail-elkorchi/html-parser/tree/main/docs/reference)
- [Explanation](https://github.com/Ismail-elkorchi/html-parser/tree/main/docs/explanation)

## Release Validation

```bash
npm run check:fast
npm run docs:lint:jsr
npm run docs:test:jsr
npm run examples:run
npm pack --dry-run
```

Release workflow details: [RELEASING.md](https://github.com/Ismail-elkorchi/html-parser/blob/main/RELEASING.md)
