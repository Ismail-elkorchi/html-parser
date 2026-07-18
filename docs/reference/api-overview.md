# API Overview

## JSR Surface

JSR exports are defined by [`jsr/mod.ts`](../../jsr/mod.ts).

Primary JSR runtime exports:
- `parse(input, options?)`
- `parseBytes(input, options?)`
- `parseFragment(input, contextTagName, options?)`
- `parseStream(stream, options?)`
- `serialize(input, operationOptions?)`
- `visibleText(input, options?)`
- `tokenizeStream(stream, options?)`
- `HtmlAbortError`, `HtmlBudgetExceededError`, `HtmlConfigurationError`,
  `HtmlPatchPlanningError`, `HtmlStreamReadError`
- `isHtmlAbortError`, `isHtmlBudgetExceededError`, `isHtmlConfigurationError`,
  `isHtmlPatchPlanningError`, `isHtmlStreamReadError`,
  `isHtmlOperationalError`

Primary JSR type exports:
- `ParseBudgets`, `ParseOptions`, `TokenizeStreamBudgets`,
  `TokenizeStreamOptions`, `OperationOptions`
- `DocumentTree`, `FragmentTree`, `HtmlNode`, `ParseError`
- `VisibleTextOptions`, `SerializableHtml`, `VisibleTextInput`, `HtmlToken`
- `HtmlOperationalError`, `HtmlBudgetName`,
  `HtmlConfigurationErrorReason`, `HtmlPatchPlanningReason`, `NodeId`

## Node/npm Surface

Node/npm type surface is shipped from `dist/mod.d.ts` (source: `src/public/mod.ts`).

In addition to the shared parse and operational-error surface, Node/npm includes:
- `visibleTextTokens(...)`
- `visibleTextTokensWithProvenance(...)`
- `getParseErrorSpecRef(parseErrorId)`
- traversal/search helpers (`walk`, `walkElements`, `findById`, `findAllByTagName`, `findAllByAttr`, `textContent`)
- structural helpers (`outline`, `chunk`)
- patch planning helpers (`computePatch`, `applyPatchPlan`)
- span metadata fields including `spanProvenance` on parsed nodes when spans are enabled
- per-operation monotonic deadlines and abort signals on serialization,
  traversal, extraction, outlining, and chunking

## JSR Surface vs Node Surface

- JSR is intentionally slimmer for Deno/JSR consumers.
- Node/npm exposes the broader authoring and transformation surface.
- Both surfaces share the same parse model, operational error classes and
  structural guards, and option types where names overlap.

## Related
- [Options](./options.md)
- [Data model](./data-model.md)
- [Error model](./error-model.md)
