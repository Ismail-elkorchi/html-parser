# API Overview

This page tracks exported public functions from `src/public/mod.ts`.

## Parsing and encoding
- `parse`
- `parseBytes`
- `parseFragment`
- `parseStream`
- `tokenizeStream`
- `getParseErrorSpecRef`

## Traversal and extraction
- `walk`
- `walkElements`
- `textContent`
- `findById`
- `findAllByTagName`
- `findAllByAttr`
- `outline`
- `chunk`

## Text and serialization
- `visibleText`
- `visibleTextTokens`
- `visibleTextTokensWithProvenance`
- `serialize`

## Patch planning
- `computePatch`
- `applyPatchPlan`

For full behavioral and type contracts, see [`docs/spec.md`](../spec.md).
