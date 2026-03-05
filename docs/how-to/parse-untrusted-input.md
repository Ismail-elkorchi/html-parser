# Parse Untrusted Input Safely

Goal: parse unknown HTML without allowing memory or CPU blowups.

```ts
import { BudgetExceededError, parse } from "@ismail-elkorchi/html-parser";

const input = "<div>".repeat(20_000);

try {
  const tree = parse(input, {
    budgets: {
      maxInputBytes: 64_000,
      maxNodes: 4_000,
      maxDepth: 128
    }
  });

  console.log(tree.kind);
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.log(error.payload.code, error.payload.budget);
  } else {
    throw error;
  }
}
```

Expected output:
- Deterministic success on bounded input, or a structured `BUDGET_EXCEEDED` failure.
