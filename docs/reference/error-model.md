# Error Model

Operational failures are thrown. HTML parse diagnostics remain deterministic
entries in `DocumentTree.errors` or `FragmentTree.errors`; they are never
returned wrappers for an exception.

Use the exported structural guards at package boundaries. They classify by
stable direct fields and therefore work across JavaScript realms and duplicate
installed package copies, where `instanceof` may fail.

| Class | Stable `code` | Direct fields |
| --- | --- | --- |
| `HtmlBudgetExceededError` | `BUDGET_EXCEEDED` | `budget`, `limit`, `actual` |
| `HtmlConfigurationError` | `INVALID_CONFIGURATION` | `option`, `reason`, `expected` |
| `HtmlPatchPlanningError` | `PATCH_PLANNING_FAILED` | `reason`, optional `target`, optional `detail` |
| `HtmlStreamReadError` | `STREAM_READ_FAILED` | `cause` |

Instances and their direct fields are frozen. There is no nested `payload`
object. `HtmlStreamReadError.cause` is the exact value thrown while acquiring or
reading the source stream; cancellation or cleanup failures do not replace it.
Budget, configuration, parse, callback, and patch failures retain their own
categories and are not wrapped as stream-read failures.

`HtmlConfigurationError.reason` is one of `UNKNOWN_OPTION`, `INVALID_VALUE`, or
`CONFLICTING_OPTIONS`. `HtmlPatchPlanningError.reason` supplies the specific
patch failure such as `NODE_NOT_FOUND`, `NON_INPUT_SPAN_PROVENANCE`,
`OVERLAPPING_EDITS`, `INVALID_PLAN_SLICE`, or `INVALID_PLAN_INSERTION`.

```ts
import {
  isHtmlBudgetExceededError,
  isHtmlOperationalError,
  parse
} from "@ismail-elkorchi/html-parser";

try {
  parse("<html>", { budgets: { maxNodes: 1 } });
} catch (error) {
  if (isHtmlBudgetExceededError(error)) {
    console.error(error.code, error.budget, error.limit, error.actual);
  } else if (isHtmlOperationalError(error)) {
    console.error(error.code);
  } else {
    throw error;
  }
}
```
