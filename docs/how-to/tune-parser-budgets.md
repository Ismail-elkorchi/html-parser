# Tune Parser Budgets

## Goal
Set `ParseOptions.budgets` so large or hostile HTML fails predictably instead of
forcing callers to guess where the parser will stop.

## Prerequisites
- `@ismail-elkorchi/html-parser` installed
- A representative large-input sample from your workload

## Copy/paste
```ts
import { BudgetExceededError, parse } from "@ismail-elkorchi/html-parser";

const html = "<div>".repeat(20_000);

function run(maxNodes: number) {
  try {
    parse(html, {
      budgets: {
        maxInputBytes: 64_000,
        maxNodes,
        maxDepth: 256,
        maxTimeMs: 250
      }
    });
    console.log(`maxNodes=${maxNodes}: ok`);
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      console.log(`maxNodes=${maxNodes}: ${error.payload.code} ${error.payload.budget}`);
      return;
    }
    throw error;
  }
}

run(2_000);
run(20_000);
```

## Expected output
```txt
maxNodes=2000: BUDGET_EXCEEDED maxNodes
maxNodes=20000: ok
```

## Common failure modes
- `maxInputBytes` is lower than the actual transport payload size, so parsing
  fails before tree construction starts.
- `maxNodes` or `maxDepth` is sized for happy-path documents instead of real
  hostile inputs.
- `maxTimeMs` is left unset for internet-facing paths, which removes the
  last-resort wall-clock bound.

## Related reference
- [Options](../reference/options.md)
- [Error model](../reference/error-model.md)
- [Performance characteristics](../explanation/performance-characteristics.md)
