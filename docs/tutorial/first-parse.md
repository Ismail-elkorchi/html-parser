# First Parse Walkthrough

This tutorial shows the minimum flow to parse HTML, extract text, and serialize output.

## 1. Parse HTML

```ts
import { parse } from "@ismail-elkorchi/html-parser";

const tree = parse("<article><h1>Hello</h1><p>World</p></article>");
console.log(tree.kind);
```

## 2. Extract visible text

```ts
import { parse, visibleText } from "@ismail-elkorchi/html-parser";

const tree = parse("<article><h1>Hello</h1><p>World</p></article>");

const text = visibleText(tree);
console.log(text);
```

## 3. Serialize deterministic output

```ts
import { parse, serialize } from "@ismail-elkorchi/html-parser";

const tree = parse("<article><h1>Hello</h1><p>World</p></article>");

const html = serialize(tree);
console.log(html);
```

## 4. Run the bundled examples

```bash
npm run examples:run
```

If `examples:run` passes, your local install can execute the same paths used in CI/evaluation profiles.
