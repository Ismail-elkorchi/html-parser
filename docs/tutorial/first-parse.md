# First Parse Success

This tutorial gets you from install to deterministic parse output in under five minutes.

## Step 1: Parse HTML

```ts
import { parse } from "@ismail-elkorchi/html-parser";

const document = parse("<article><h1>Hello</h1><p>World</p></article>");
console.log(document.tree.kind);
console.log(document.tree.children.length);
```

Expected output:

```txt
document
1
```

## Step 2: Extract bounded visible text

```ts
import {
  VISIBLE_TEXT_HTML_POLICY,
  extractText,
  parse
} from "@ismail-elkorchi/html-parser";

const document = parse("<article><h1>Hello</h1><p>World</p></article>");
const result = extractText(document.tree, {
  policy: VISIBLE_TEXT_HTML_POLICY,
  maxOutputBytes: 4_096,
  maxTokens: 256,
  maxFallbackInputBytes: 4_096,
  maxFallbackNodes: 256
});
console.log(result.text);
```

Expected output:

```txt
Hello World
```

## Step 3: Serialize normalized output

```ts
import { parse, serialize } from "@ismail-elkorchi/html-parser";

const document = parse("<main><p>Stable</p></main>");
console.log(serialize(document.tree));
```

Expected output:

```txt
<html><head></head><body><main><p>Stable</p></main></body></html>
```

## Step 4: Run bundled examples

```bash
npm run examples:run
```

What you get:
- End-to-end confirmation that package examples run against your local build.
