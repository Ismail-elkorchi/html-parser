# Limits, errors, and safety

## Parser budgets

All parser budgets are optional, inclusive, and disabled when absent. Values
must be finite, non-negative safe integers. Option objects are closed: unknown
keys and invalid combinations throw before parsing or acquiring a stream
reader.

| Budget | What it limits |
| --- | --- |
| `maxInputBytes` | UTF-8 bytes for text input; transport bytes for byte and stream input |
| `maxDecodedUtf8Bytes` | UTF-8 bytes produced by decoding |
| `maxSteps` | Deterministic independent-engine work checkpoints |
| `maxNodes` | Public root plus input and recovery node allocations |
| `maxDepth` | Tree depth, with the public document or fragment root at depth 1 |
| `maxParseErrors` | Emitted non-fatal parse diagnostics |
| `maxAttributesPerElement` | Attempted attributes on one start tag, including discarded duplicates, and attributes retained on one tree element after recovery |
| `maxAttributeBytes` | UTF-8 bytes in attempted normalized names and decoded values on one start tag, and in attributes retained on one tree element after recovery |
| `maxTraceEvents` | Retained trace events; valid only with `trace: "events"` |
| `maxTraceBytes` | Canonical UTF-8 bytes of retained events; valid only with `trace: "events"` |
| `maxTimeMs` | Elapsed monotonic time across the operation |

Stream budgets also accept `maxEncodingPrescanBytes`, an optional meta-encoding
prefix-retention cap rather than a throwing total-input budget. BOM detection
remains active when this value is zero. Eager stream tokenization accepts
`maxSteps` and reports the observed count when it is enabled. Extraction has separate required
`maxOutputBytes` and `maxTokens` limits; visible-text extraction also requires
`maxFallbackInputBytes` and `maxFallbackNodes`.

A hard-budget failure reports deterministic `actual: limit + 1`, representing
the first unavailable unit, rather than continuing expensive work to count the
complete rejected input. Successful results report `resourceUsage.steps` when
`maxSteps` enabled counting and `null` otherwise.

## Operational errors

Use the structural guards when errors can cross realms or package boundaries.

| Error | Meaning |
| --- | --- |
| `HtmlConfigurationError` | Unknown option, invalid value, or conflicting options |
| `HtmlBudgetExceededError` | A named resource limit was exceeded |
| `HtmlAbortError` | An `AbortSignal` cancelled the operation |
| `HtmlStreamReadError` | Stream reader acquisition or reading failed |
| `HtmlPatchPlanningError` | A patch target, span, plan, or source identity was invalid |

```ts
import {
  isHtmlAbortError,
  isHtmlBudgetExceededError,
  parse
} from "@ismail-elkorchi/html-parser";

try {
  parse("<p>bounded</p>", { budgets: { maxNodes: 1 } });
} catch (error: unknown) {
  if (isHtmlBudgetExceededError(error)) {
    console.error(error.budget, error.limit, error.actual);
  } else if (isHtmlAbortError(error)) {
    console.error("cancelled", error.cause);
  } else {
    throw error;
  }
}
```

`isHtmlOperationalError()` recognizes every operational class. Specific guards
are also exported for configuration, patch, and stream errors. Non-fatal HTML
parse diagnostics live on the returned tree and are not operational errors.

## Cancellation and deadlines

Parse options accept `signal`; non-parse operations accept `signal` and
`maxTimeMs` through `OperationOptions`. Each call owns its deadline—a parse
deadline is not reused by later traversal or serialization. Visible-text
fallback work shares the extraction operation's remaining deadline and signal.

## Parsing is not sanitization

Parsing preserves dangerous elements, attributes, and URLs so consumers can
inspect them. Serialization and patching do not make content safe. If output
will be inserted into a browser, run a context-appropriate sanitizer after the
transformation and before rendering.

Resource budgets reduce denial-of-service exposure but do not establish a
security boundary on their own. Bound the complete containing workflow,
including transport, parser work, extraction, storage, and downstream use.

Report suspected vulnerabilities through [SECURITY.md](../SECURITY.md), not a
public issue.
