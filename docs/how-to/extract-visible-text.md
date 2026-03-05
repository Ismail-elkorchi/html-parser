# Extract Visible Text

Goal: extract stable text output from HTML for indexing or auditing.

```ts
import { parse, visibleText, visibleTextTokens } from "@ismail-elkorchi/html-parser";

const tree = parse("<article><h1>Title</h1><p>Hello <strong>world</strong>.</p></article>");

console.log(visibleText(tree).trim());
console.log(visibleTextTokens(tree).length);
```

Expected output:
- A normalized text string.
- Token-level text pieces in deterministic order.
