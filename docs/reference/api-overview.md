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
- `tokenizeByteStreamEager(stream, options?)`
- `HtmlAbortError`, `HtmlBudgetExceededError`, `HtmlConfigurationError`,
  `HtmlPatchPlanningError`, `HtmlStreamReadError`
- `isHtmlAbortError`, `isHtmlBudgetExceededError`, `isHtmlConfigurationError`,
  `isHtmlPatchPlanningError`, `isHtmlStreamReadError`,
  `isHtmlOperationalError`
- namespace constants, HTML attribute helpers, and HTML/exact-namespace query
  helpers

Primary JSR type exports:
- `ParseBudgets`, `ParseOptions`, `ParseBytesOptions`, `ParseFragmentOptions`,
  `ParseStreamBudgets`, `ParseStreamOptions`, `SourceRetention`,
  `TokenizeByteStreamEagerBudgets`, `TokenizeByteStreamEagerOptions`,
  `OperationOptions`
- `ParsedDocument`, `ParsedDocumentMetadata`, `ParseEncodingMetadata`,
  `ParseResourceUsage`, `DocumentTree`, `FragmentTree`, the exact
  namespace-aware `HtmlNode` union,
  `Attribute`, `DoctypeExternalId`, `Span`, `SpanProvenance`, and `ParseError`
- `VisibleTextOptions`, `SerializableHtml`, `VisibleTextInput`, `HtmlToken`
- `HtmlOperationalError`, `HtmlBudgetName`,
  `HtmlConfigurationErrorReason`, `HtmlPatchPlanningReason`, `NodeId`

## Node/npm Surface

Node/npm type surface is shipped from `dist/mod.d.ts` (source: `src/public/mod.ts`).

In addition to the shared parse and operational-error surface, Node/npm includes:
- `ParseBudgetOptions`, `ParseBytesOptions`, `ParseFragmentOptions`,
  `ParseStreamBudgetOptions`, and the shared `ParseStreamOptions` contract
- `visibleTextTokens(...)`
- `visibleTextTokensWithProvenance(...)`
- `getParseErrorSpecRef(parseErrorId)`
- traversal/search helpers (`walk`, `walkElements`, `findById`,
  `findAllByTagName`, `findAllByTagNameNS`, `findAllByAttr`,
  `findAllByAttrNS`, `textContent`)
- shared attribute helpers (`getAttributeValue`, `hasAttribute`,
  `getAttributeValueNS`, `hasAttributeNS`) and canonical HTML/SVG/MathML/XLink/
  XML/XMLNS namespace URI constants
- structural helpers (`outline`, `chunk`)
- patch planning helpers (`computePatch`, `applyPatchPlan`)
- span metadata fields including `spanProvenance` on parsed nodes when spans are enabled
- optional exact decoded-source retention and successful parse resource/encoding metadata
- per-operation monotonic deadlines and abort signals on serialization,
  traversal, extraction, outlining, and chunking

## JSR Surface vs Node Surface

- JSR is intentionally slimmer for Deno/JSR consumers, but exposes the same
  parsed-node identity, namespace constants, attribute helpers, and structural
  queries.
- Node/npm exposes the broader authoring and transformation surface.
- Both surfaces share the same parse model, operational error classes and
  structural guards, and option types where names overlap.

## Related
- [Options](./options.md)
- [Data model](./data-model.md)
- [Error model](./error-model.md)
