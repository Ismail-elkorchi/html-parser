# Tune Parser Budgets

Goal: set limits that match your workload and fail predictably.

```ts
import { BudgetExceededError, parse } from "@ismail-elkorchi/html-parser";

const html = "<div>".repeat(20_000);

function run(maxNodes: number) {
  try {
    parse(html, {
      budgets: {
        maxInputBytes: 64_000,
        maxNodes,
        maxDepth: 256
      }
    });
    console.log(`maxNodes=${maxNodes}: ok`);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      console.log(`maxNodes=${maxNodes}:`, error.payload.code, error.payload.budget);
      return;
    }
    throw error;
  }
}

run(2_000);
run(20_000);
```

Expected output:
- A lower budget run fails with `BUDGET_EXCEEDED`.
- A higher budget run succeeds.
