# Extract Text Safely

## Goal
Get stable visible text from untrusted HTML while bounding parser work and
keeping sanitization as a separate step.

## Prerequisites
- `@ismail-elkorchi/html-parser` installed
- Untrusted or user-supplied HTML input

## Copy/paste
```ts
import { BudgetExceededError, parse, visibleText } from "@ismail-elkorchi/html-parser";

const input = `
  <article>
    <h1>Release</h1>
    <p>Hello <strong>world</strong>.</p>
    <script>console.log("not visible text")</script>
  </article>
`;

try {
  const tree = parse(input, {
    budgets: {
      maxInputBytes: 8_192,
      maxNodes: 512,
      maxDepth: 64
    }
  });

  console.log(visibleText(tree, { trim: true }));
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.log(error.payload.code, error.payload.budget);
  } else {
    throw error;
  }
}
```

## Expected output
```txt
Release Hello world.
```

## Common failure modes
- `BudgetExceededError` when the input exceeds `maxInputBytes`, `maxNodes`, or
  `maxDepth`.
- Hidden or scripted content expectations are wrong because `visibleText()` is
  about deterministic text extraction, not browser execution.
- Unsafe downstream rendering because the caller treated extracted text as
  evidence that the source HTML is safe.

## Related reference
- [Options](../reference/options.md)
- [Data model](../reference/data-model.md)
- [Error model](../reference/error-model.md)
- [Why parsing is not sanitization](./parsing-is-not-sanitization.md)
