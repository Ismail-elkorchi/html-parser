# Error Model

## `BudgetExceededError`

Thrown when configured budgets are exceeded.

Payload fields:
- `code`: `"BUDGET_EXCEEDED"`
- `budget`: which budget was exceeded (for example `maxNodes`)
- `limit`: configured limit
- `actual`: observed value

## `PatchPlanningError`

Thrown when patch planning cannot safely apply an edit.

Payload fields:
- `code`: stable machine-readable code
- `target`: optional node id that caused the failure

## Parse errors

`parse`, `parseBytes`, `parseFragment`, and `parseStream` return parse-error arrays.
Use `getParseErrorSpecRef(parseErrorId)` for stable spec references.

## Handling pattern

```ts
import { BudgetExceededError, PatchPlanningError, parse } from "@ismail-elkorchi/html-parser";

try {
  parse("<html>", { budgets: { maxNodes: 1 } });
} catch (error) {
  if (error instanceof BudgetExceededError || error instanceof PatchPlanningError) {
    console.error(error.name);
  }
}
```
