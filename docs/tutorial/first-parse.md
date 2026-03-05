# First Parse Success

This tutorial gets you from install to deterministic parse output in under five minutes.

## Step 1: Parse HTML

```ts
import { parse } from "@ismail-elkorchi/html-parser";

const tree = parse("<article><h1>Hello</h1><p>World</p></article>");
console.log(tree.kind);
console.log(tree.children.length);
```

Expected output:

```txt
document
1
```

## Step 2: Extract visible text

```ts
import { parse, visibleText } from "@ismail-elkorchi/html-parser";

const tree = parse("<article><h1>Hello</h1><p>World</p></article>");
console.log(visibleText(tree).trim());
```

Expected output:

```txt
Hello World
```

## Step 3: Serialize normalized output

```ts
import { parse, serialize } from "@ismail-elkorchi/html-parser";

const tree = parse("<main><p>Stable</p></main>");
console.log(serialize(tree));
```

Expected output:

```txt
<main><p>Stable</p></main>
```

## Step 4: Run bundled examples

```bash
npm run examples:run
```

What you get:
- End-to-end confirmation that package examples run against your local build.
