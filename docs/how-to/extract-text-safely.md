# Extract Text Safely

Goal: get stable visible text from untrusted HTML with explicit parse limits.

```ts
import { BudgetExceededError, parse, visibleText } from "@ismail-elkorchi/html-parser";

const input = "<article><h1>Release</h1><p>Hello <strong>world</strong>.</p></article>";

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

Expected output:
- Deterministic text content such as `Release Hello world.`
- Or a structured `BUDGET_EXCEEDED` payload when limits are too strict.
