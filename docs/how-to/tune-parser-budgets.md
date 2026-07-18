# Tune Parser Budgets

## Goal
Set `ParseOptions.budgets` so large or hostile HTML fails predictably instead of
forcing callers to guess where the parser will stop.

## Prerequisites
- `@ismail-elkorchi/html-parser` installed
- A representative large-input sample from your workload

## Copy/paste
```ts
import { isHtmlBudgetExceededError, parse } from "@ismail-elkorchi/html-parser";

const html = "<div>".repeat(20_000);

function run(maxNodes: number) {
  try {
    parse(html, {
      budgets: {
        maxInputBytes: 64_000,
        maxDecodedUtf8Bytes: 64_000,
        maxNodes,
        maxDepth: 256,
        maxParseErrors: 128,
        maxAttributesPerElement: 256,
        maxAttributeBytes: 32_768,
        maxTimeMs: 250
      }
    });
    console.log(`maxNodes=${maxNodes}: ok`);
  } catch (error) {
    if (isHtmlBudgetExceededError(error)) {
      console.log(`maxNodes=${maxNodes}: ${error.code} ${error.budget}`);
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
- `maxEncodingPrescanBytes` is added to non-stream `ParseOptions` or mistaken
  for a complete-stream cap. It is accepted only by stream operations and
  limits only encoding-prescan retention; use `maxInputBytes` and
  `maxDecodedUtf8Bytes` for total transport and decoded-output bounds.
- `maxNodes` or `maxDepth` is sized for happy-path documents instead of real
  hostile inputs.
- Attribute budgets omit duplicate attempts. Duplicate attributes are counted
  because their names and values allocate before HTML duplicate elimination.
- `maxTimeMs` is left unset for internet-facing paths, which removes the
  last-resort wall-clock bound.

All values must be finite non-negative safe integers. Zero is a valid hard
limit. Unknown keys fail as configuration errors before a stream reader is
acquired.

## Related reference
- [Options](../reference/options.md)
- [Error model](../reference/error-model.md)
- [Performance characteristics](../explanation/performance-characteristics.md)
