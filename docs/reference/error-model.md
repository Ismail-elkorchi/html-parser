# Error Model

Operational failures are thrown. HTML parse diagnostics remain deterministic
entries in `DocumentTree.errors` or `FragmentTree.errors`; they are never
returned wrappers for an exception.

Use the exported structural guards at package boundaries. They classify by
stable direct fields and therefore work across JavaScript realms and duplicate
installed package copies, where `instanceof` may fail.

| Class | Stable `code` | Direct fields |
| --- | --- | --- |
| `HtmlAbortError` | `ABORTED` | `cause` |
| `HtmlBudgetExceededError` | `BUDGET_EXCEEDED` | `budget`, `limit`, `actual` |
| `HtmlConfigurationError` | `INVALID_CONFIGURATION` | `option`, `reason`, `expected` |
| `HtmlPatchPlanningError` | `PATCH_PLANNING_FAILED` | `reason`, optional `target`, optional `detail` |
| `HtmlStreamReadError` | `STREAM_READ_FAILED` | `cause` |

Instances and their direct fields are frozen. There is no nested `payload`
object. `HtmlAbortError.cause` is the exact `AbortSignal.reason`.
`HtmlStreamReadError.cause` is the exact value thrown while acquiring or reading
the source stream; cancellation or cleanup failures do not replace it.
Budget, configuration, parse, callback, and patch failures retain their own
categories and are not wrapped as stream-read failures.

All budget limits are inclusive and a failure reports `actual: limit + 1`.
Invalid, fractional, negative, non-finite, or unknown limits are configuration
errors rather than budget failures. Configuration validation takes priority
over an already-aborted signal and occurs before stream-reader acquisition.
The extraction-only `maxFallbackInputBytes` and `maxFallbackNodes` budgets use
the same error shape when an HTML `noscript` fallback exceeds its configured
reparse limit. `maxOutputBytes` and `maxTokens` are retention caps: they set the
successful result's `truncated` flag instead of throwing.

`HtmlConfigurationError.reason` is one of `UNKNOWN_OPTION`, `INVALID_VALUE`, or
`CONFLICTING_OPTIONS`. `HtmlPatchPlanningError.reason` supplies the specific
patch failure. Identity/source prerequisites use
`UNRECOGNIZED_PARSED_DOCUMENT`, `SOURCE_NOT_RETAINED`, `SPANS_NOT_CAPTURED`,
or `PLAN_SOURCE_MISMATCH`; edit failures include `NODE_NOT_FOUND`,
`NON_INPUT_SPAN_PROVENANCE`, and `OVERLAPPING_EDITS`.

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
