# API Overview

All exported runtime entrypoints from `src/public/mod.ts`.

## Error classes
- `BudgetExceededError`
- `PatchPlanningError`

## Parsing and encoding
- `getParseErrorSpecRef(parseErrorId)`
- `parse(input, options?)`
- `parseBytes(input, options?)`
- `parseFragment(input, contextTagName?, options?)`
- `tokenizeStream(stream, options?)`
- `parseStream(stream, options?)`
- `serialize(treeOrNode)`

## Text extraction
- `visibleText(nodeOrTree, options?)`
- `visibleTextTokens(nodeOrTree, options?)`
- `visibleTextTokensWithProvenance(nodeOrTree, options?)`

## Traversal helpers
- `walk(nodeOrTree, visitor)`
- `walkElements(nodeOrTree, visitor)`
- `textContent(nodeOrTree)`
- `findById(nodeOrTree, id)`
- `findAllByTagName(nodeOrTree, tagName)`
- `findAllByAttr(nodeOrTree, name, value?)`
- `outline(nodeOrTree)`
- `chunk(nodeOrTree, options?)`

## Patch planning
- `applyPatchPlan(originalHtml, plan)`
- `computePatch(originalHtml, edits)`
- Node span metadata includes `spanProvenance` (`input`, `inferred`, or `none`) when spans are enabled.

## Related reference pages
- [Options](./options.md)
- [Error model](./error-model.md)
