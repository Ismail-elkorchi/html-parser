# API Overview

## JSR Surface

JSR exports are defined by [`jsr/mod.ts`](../../jsr/mod.ts).

Primary JSR runtime exports:
- `parse(input, options?)`
- `parseBytes(input, options?)`
- `parseFragment(input, contextTagName, options?)`
- `parseStream(stream, options?)`
- `serialize(input)`
- `visibleText(input, options?)`
- `tokenizeStream(stream, options?)`

Primary JSR type exports:
- `ParseBudgets`, `ParseOptions`, `TokenizeStreamOptions`
- `DocumentTree`, `FragmentTree`, `HtmlNode`, `ParseError`
- `VisibleTextOptions`, `SerializableHtml`, `VisibleTextInput`, `HtmlToken`

## Node/npm Surface

Node/npm type surface is shipped from `dist/mod.d.ts` (source: `src/public/mod.ts`).

In addition to JSR exports, Node/npm includes:
- `visibleTextTokens(...)`
- `visibleTextTokensWithProvenance(...)`
- `BudgetExceededError`, `PatchPlanningError`, `getParseErrorSpecRef(parseErrorId)`
- traversal/search helpers (`walk`, `walkElements`, `findById`, `findAllByTagName`, `findAllByAttr`, `textContent`)
- structural helpers (`outline`, `chunk`)
- patch planning helpers (`computePatch`, `applyPatchPlan`)

## JSR Surface vs Node Surface

- JSR is intentionally slimmer for Deno/JSR consumers.
- Node/npm exposes the broader authoring and transformation surface.
- Both surfaces share the same parse model and option types where names overlap.

## Related
- [Options](./options.md)
- [Data model](./data-model.md)
- [Error model](./error-model.md)
