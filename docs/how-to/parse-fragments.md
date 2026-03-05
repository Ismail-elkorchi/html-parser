# Parse Fragments

Goal: parse partial HTML in a known element context.

```ts
import { parseFragment, serialize } from "@ismail-elkorchi/html-parser";

const fragment = parseFragment("<li>first</li><li>second</li>", "ul", {
  budgets: {
    maxInputBytes: 4_096,
    maxNodes: 256,
    maxDepth: 32
  }
});

console.log(fragment.kind);
console.log(fragment.children.length);
console.log(fragment.children.map((node) => serialize(node)).join(""));
```

Expected output:
- `fragment`
- `2`
- `<li>first</li><li>second</li>`
