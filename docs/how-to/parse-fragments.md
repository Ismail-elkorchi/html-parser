# Parse Fragments

## Goal
Parse partial HTML relative to a known element context such as `ul`, `table`,
or `template`.

## Prerequisites
- `@ismail-elkorchi/html-parser` installed
- A fragment string and the element context it will be inserted into

## Copy/paste
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
console.log(fragment.contextTagName);
console.log(fragment.children.length);
console.log(fragment.children.map((node) => serialize(node)).join(""));
```

## Expected output
```txt
fragment
ul
2
<li>first</li><li>second</li>
```

## Common failure modes
- `INVALID_FRAGMENT_CONTEXT` when the context tag name is invalid for fragment
  parsing.
- `BudgetExceededError` when `maxInputBytes`, `maxNodes`, or `maxDepth` is too
  low for the fragment.
- Unexpected structure when the fragment is parsed with the wrong context, such
  as table cells parsed outside a table-like context.

## Related reference
- [Options](../reference/options.md)
- [Data model](../reference/data-model.md)
- [Error model](../reference/error-model.md)
