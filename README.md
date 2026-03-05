# @ismail-elkorchi/html-parser

Deterministic HTML parsing for automation workflows that need stable output across Node, Deno, Bun, and modern browsers.

No runtime dependencies: this package ships with zero runtime dependencies.

## When To Use

- You need deterministic parse and serialize output.
- You need explicit resource budgets for untrusted input.
- You need consistent behavior across Node, Deno, Bun, and browser smoke paths.

## When Not To Use

- You need HTML sanitization.
- You need a full browser engine with script execution.
- You need DOM mutation semantics beyond deterministic parse utilities.

## Install

```bash
npm install @ismail-elkorchi/html-parser
```

```bash
deno add jsr:@ismail-elkorchi/html-parser
```

## Import

```ts
import { parse } from "@ismail-elkorchi/html-parser";
```

```txt
import { parse } from "jsr:@ismail-elkorchi/html-parser";
```

## Copy/Paste Examples

### Example 1: Parse a document

```ts
import { parse } from "@ismail-elkorchi/html-parser";

const tree = parse("<main><h1>Hello</h1></main>");
console.log(tree.kind);
```

### Example 2: Parse streaming bytes

```ts
import { parseStream } from "@ismail-elkorchi/html-parser";

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("<p>streamed</p>"));
    controller.close();
  }
});

const tree = await parseStream(stream, { budgets: { maxInputBytes: 4096, maxBufferedBytes: 512 } });
console.log(tree.kind);
```

### Example 3: Extract visible text

```ts
import { parse, visibleText } from "@ismail-elkorchi/html-parser";

const tree = parse("<article><h1>Title</h1><p>Hello world.</p></article>");
console.log(visibleText(tree).trim());
```

### Example 4: Compute and apply a patch plan

```ts
import { applyPatchPlan, computePatch } from "@ismail-elkorchi/html-parser";

const plan = computePatch("<p>Draft</p>", []);
const patched = applyPatchPlan("<p>Draft</p>", plan);
console.log(patched);
```

Run packaged examples:

```bash
npm run examples:run
```

## Compatibility

Runtime compatibility matrix:

| Runtime | Status |
| --- | --- |
| Node.js | Supported |
| Deno | Supported |
| Bun | Supported |
| Browser (evergreen) | Supported |

## Security and Safety Notes

Parsing is not sanitization. For untrusted input:
- set strict budgets,
- handle `BudgetExceededError` explicitly,
- sanitize separately before rendering.

## Docs Map

- [Docs index](https://github.com/Ismail-elkorchi/html-parser/blob/main/docs/index.md)
- [Tutorial](https://github.com/Ismail-elkorchi/html-parser/blob/main/docs/tutorial/first-parse.md)
- [How-to guides](https://github.com/Ismail-elkorchi/html-parser/tree/main/docs/how-to)
- [Reference](https://github.com/Ismail-elkorchi/html-parser/tree/main/docs/reference)
- [Explanation](https://github.com/Ismail-elkorchi/html-parser/tree/main/docs/explanation)
