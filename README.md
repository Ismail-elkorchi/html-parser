# html-parser

Agent-first TypeScript HTML parser with deterministic output, bounded execution, and zero runtime dependencies.

`docs/spec.md` is the normative API contract. This README is operational guidance and examples.

## What this library is
- Deterministic HTML parsing and serialization for agent and automation workflows.
- Web-API-first runtime design that runs on Node, Deno, Bun, and modern browsers.
- Structured budgeting and trace output for bounded, explainable parsing.
- Patch planning primitives for deterministic rewrite workflows.
- No runtime dependencies are used by production library code.

## What this library is not
- Not a DOM implementation.
- Not a CSS selector engine.
- Not a sanitizer.

See `docs/ecosystem-comparison.md` for a scope comparison against parse5, htmlparser2, cheerio, jsdom, linkedom, deno-dom, and HTMLRewriter/lol-html.

## Runtime compatibility
- Node.js: current stable and active LTS with Web Streams and TextDecoder support.
- Deno: stable channel.
- Bun: stable channel.
- Browsers: modern evergreen engines.

See `docs/runtime-compatibility.md` for the exact runtime API surface used by `src/`.

### Browser bundling
The runtime uses Web APIs and ESM.
Use a standard ESM bundler (Vite, Rollup, esbuild, webpack in ESM mode) and import from the package entrypoint.
No Node builtin polyfills are required for runtime code.

## Install
```bash
npm install html-parser
```

## Quickstart

### Parse a string
```ts
import { parse } from "html-parser";

const tree = parse("<p>Hello</p>");
console.log(tree.kind); // "document"
console.log(tree.children.length);
```

### Parse bytes with encoding sniff
```ts
import { parseBytes } from "html-parser";

const bytes = new Uint8Array([
  0x3c, 0x6d, 0x65, 0x74, 0x61, 0x20, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x3d, 0x77, 0x69,
  0x6e, 0x64, 0x6f, 0x77, 0x73, 0x2d, 0x31, 0x32, 0x35, 0x32, 0x3e, 0x3c, 0x70, 0x3e, 0xe9, 0x3c,
  0x2f, 0x70, 0x3e
]);

const tree = parseBytes(bytes);
```

### Parse a stream
```ts
import { parseStream } from "html-parser";

const stream = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("<div>"));
    controller.enqueue(new TextEncoder().encode("ok"));
    controller.enqueue(new TextEncoder().encode("</div>"));
    controller.close();
  }
});

const tree = await parseStream(stream, {
  budgets: {
    maxInputBytes: 1024,
    maxBufferedBytes: 256
  }
});
```

### Tokenize a stream
```ts
import { tokenizeStream } from "html-parser";

const stream = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("<p>alpha</p>"));
    controller.close();
  }
});

for await (const token of tokenizeStream(stream, {
  budgets: { maxInputBytes: 1024, maxBufferedBytes: 256 }
})) {
  console.log(token.kind);
}
```

### Serialize a parsed tree
```ts
import { parse, serialize } from "html-parser";

const tree = parse("<section><p>x</p></section>");
const html = serialize(tree);
```

### Trace with budgets
```ts
import { parse } from "html-parser";

const tree = parse("<table><tr><td>x</td></tr></table>", {
  trace: true,
  budgets: {
    maxTraceEvents: 64,
    maxTraceBytes: 4096
  }
});

for (const event of tree.trace ?? []) {
  console.log(event.kind, event.seq);
}
```

### Compute and apply a patch plan
```ts
import { applyPatchPlan, computePatch, parse } from "html-parser";

const originalHtml = "<p class=\"x\">before</p>";
const tree = parse(originalHtml, { captureSpans: true });

const findFirst = (nodes, predicate) => {
  for (const node of nodes) {
    if (predicate(node)) return node;
    if (node.kind === "element") {
      const nested = findFirst(node.children, predicate);
      if (nested) return nested;
    }
  }
  return null;
};

const paragraph = findFirst(tree.children, (node) => node.kind === "element" && node.tagName === "p");
// In real usage, target node IDs come from your traversal logic.
const targetNodeId = paragraph?.id ?? tree.id;
const textNodeId = paragraph
  ? (findFirst(paragraph.children, (node) => node.kind === "text")?.id ?? tree.id)
  : tree.id;

const plan = computePatch(originalHtml, [
  {
    kind: "setAttr",
    target: targetNodeId,
    name: "class",
    value: "updated"
  },
  {
    kind: "replaceText",
    target: textNodeId,
    value: "after"
  },
  {
    kind: "insertHtmlAfter",
    target: targetNodeId,
    html: "<hr>"
  }
]);

const patchedHtml = applyPatchPlan(originalHtml, plan);
```

### Outline and chunk for agent consumption
```ts
import { chunk, outline, parse } from "html-parser";

const tree = parse("<h1>A</h1><h2>B</h2><p>text</p>");
const docOutline = outline(tree);
const chunks = chunk(tree, { maxChars: 120, maxNodes: 8 });
```

### Traverse and extract
```ts
import {
  findAllByAttr,
  findAllByTagName,
  findById,
  parse,
  textContent,
  walkElements
} from "html-parser";

const tree = parse("<article id=\"a\"><h1>x</h1><p data-role=\"lead\">hello</p></article>");

walkElements(tree, (element) => {
  console.log(element.tagName);
});

const article = [...findAllByTagName(tree, "article")][0];
const leadNodes = [...findAllByAttr(tree, "data-role", "lead")];
const sameNode = article ? findById(tree, article.id) : null;
const articleText = article ? textContent(article) : "";
```

## Determinism contract
For equal input and equal options:
- parse output structure is stable,
- NodeId assignment order is stable,
- serialization output is stable,
- trace event sequence is stable when enabled under the same budgets.

This makes agent retries and diff-based workflows reproducible.

## Budgets contract
Budget limits provide bounded execution for untrusted or extreme input.
On budget exceed, the library throws `BudgetExceededError` with structured payload:

```ts
{
  code: "BUDGET_EXCEEDED",
  budget: "maxInputBytes" | "maxBufferedBytes" | "maxNodes" | "maxDepth" | "maxTraceEvents" | "maxTraceBytes" | "maxTimeMs",
  limit: number,
  actual: number
}
```

## Security model
- Parsing untrusted HTML is supported.
- Parsing is not sanitization.
- Budgets are the primary parser-side control against parsing DoS behavior.
- If your browser use case needs sanitization, use platform sanitization mechanisms such as the Sanitizer API.

## Evaluation commands
```bash
npm run lint
npm run typecheck
npm run build
npm test
npm run eval:ci
npm run eval:release
```

## Additional docs
- Normative API and behavior contract: `docs/spec.md`
- Acceptance gates and profile requirements: `docs/acceptance-gates.md`
- Runtime API portability mapping: `docs/runtime-compatibility.md`
- Agent-first behavior checklist: `docs/agent-first.md`
- Release/readiness criteria: `docs/readiness.md`
