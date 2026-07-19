# Getting started

This project is pre-1.0. Minor releases may contain intentional breaking
changes, so use the documentation and TypeScript declarations shipped with the
version you install.

## Install

```bash
npm install @ismail-elkorchi/html-parser
```

```bash
deno add jsr:@ismail-elkorchi/html-parser
```

## Parse a document

```ts
import { parse, serialize } from "@ismail-elkorchi/html-parser";

const document = parse("<!doctype html><title>Hello</title><main>World</main>");

console.log(document.tree.kind); // "document"
console.log(document.tree.errors); // non-fatal HTML parse diagnostics
console.log(document.metadata.resourceUsage.nodes);
console.log(serialize(document.tree));
```

`parse()`, `parseBytes()`, and `parseStream()` return a frozen
`ParsedDocument`. Its `tree` is the parsed document, `metadata` describes the
exact parse, and `sourceText` is `null` unless source retention was requested.
`parseFragment()` instead returns a `FragmentTree` directly.

HTML recovery diagnostics do not normally throw. Invalid configuration,
exceeded budgets, cancellation, stream failures, and invalid patch operations
throw typed operational errors. See [limits, errors, and safety](./limits-errors-and-safety.md).

## Set limits for untrusted input

Parser limits are disabled unless you supply them. Choose limits from the
request or job budget rather than copying arbitrary global values.

```ts
import { parse } from "@ismail-elkorchi/html-parser";

const document = parse("<article><p>bounded</p></article>", {
  budgets: {
    maxInputBytes: 64 * 1_024,
    maxDecodedUtf8Bytes: 64 * 1_024,
    maxNodes: 4_096,
    maxDepth: 128,
    maxParseErrors: 256,
    maxAttributesPerElement: 128,
    maxAttributeBytes: 16 * 1_024,
    maxTimeMs: 250
  }
});

console.log(document.tree.children.length);
```

Every limit is inclusive. Missing limits are not enforced; zero is a valid
limit and does not mean “unlimited.”

## Continue by task

- Use [parsing](./parsing.md) for text, byte, and fragment entry points.
- Use [streams and encoding](./streams-and-encoding.md) for response bodies.
- Use [querying and text](./querying-and-text.md) to consume the tree.
- Use [modifying HTML](./modifying-html.md) for source-aware edits.
- Use the [API guide](./api.md) for entry points and type groups.
