# API

Runtime exports are grouped by purpose; TypeScript declarations shipped with
the package remain the exact source of truth.

## Parse and serialize

- `parse(input, options?)` parses already-decoded text and returns a
  `ParsedDocument`.
- `parseBytes(input, options?)` sniffs/decodes bytes and returns a
  `ParsedDocument`.
- `parseStream(stream, options?)` reads, decodes, and parses a byte stream.
- `parseFragment(input, contextTagName, options?)` returns a `FragmentTree`.
- `serialize(input, options?)` serializes a document, fragment, or node.
- `tokenizeByteStreamEager(stream, options?)` returns logical tokens after EOF.
- `getParseErrorSpecRef(parseErrorId)` maps a diagnostic id to its HTML
  specification reference.

## Query and traversal

- `walk(tree, visitor, options?)` visits every node.
- `walkElements(tree, visitor, options?)` visits elements only.
- `findById(tree, id, options?)` finds a parser node id.
- `findAllByTagName(tree, tagName, options?)` matches HTML tag names.
- `findAllByTagNameNS(tree, namespaceUri, localName, options?)` matches an exact
  expanded element name.
- `findAllByAttr(tree, name, value?, options?)` matches unnamespaced HTML
  attributes.
- `findAllByAttrNS(tree, namespaceUri, localName, value?, options?)` matches an
  exact expanded attribute name.
- `getAttributeValue(node, name)` and `hasAttribute(node, name)` inspect
  unnamespaced HTML attributes.
- `getAttributeValueNS(node, namespaceUri, localName)` and
  `hasAttributeNS(node, namespaceUri, localName)` inspect exact expanded names.

The namespace constants are `HTML_NAMESPACE_URI`, `SVG_NAMESPACE_URI`,
`MATHML_NAMESPACE_URI`, `XLINK_NAMESPACE_URI`, `XML_NAMESPACE_URI`, and
`XMLNS_NAMESPACE_URI`.

## Text and structural utilities

- `extractText(input, options)` returns a bounded `TextExtractionResult`.
- `iterateText(input, options)` yields bounded tokens with provenance.
- `outline(tree, options?)` builds heading and section entries.
- `chunk(tree, options?)` groups structural text by configured limits.
- `computePatch(document, edits)` validates edits and creates a source-bound
  patch plan.
- `applyPatchPlan(document, plan)` applies a plan to its originating document.

The policy constants are `VISIBLE_TEXT_HTML_POLICY` and `TEXT_CONTENT_POLICY`.

## Errors and guards

Operational classes are `HtmlBudgetExceededError`, `HtmlConfigurationError`,
`HtmlPatchPlanningError`, `HtmlStreamReadError`, and `HtmlAbortError`.

Prefer the structural guards `isHtmlBudgetExceededError`,
`isHtmlConfigurationError`, `isHtmlPatchPlanningError`,
`isHtmlStreamReadError`, `isHtmlAbortError`, and `isHtmlOperationalError` when
the value can cross realms or package boundaries.

## Type groups

Key exported type groups include:

- parsing and operations: `ParseBudgetOptions`, `ParseOptions`,
  `ParseBytesOptions`, `ParseFragmentOptions`, `ParseStreamBudgetOptions`,
  `ParseStreamOptions`, `TokenizeByteStreamEagerBudgetOptions`,
  `TokenizeByteStreamEagerOptions`, `OperationOptions`, `SourceRetention`;
- trees and metadata: `ParsedDocument`, `ParsedDocumentMetadata`,
  `ParseEncodingMetadata`, `ParseResourceUsage`, `DocumentTree`,
  `FragmentTree`, `HtmlNode`, `ElementNode`, `TextNode`, `CommentNode`,
  `DoctypeNode`, `DoctypeExternalId`, `Attribute`, `Span`, `SpanProvenance`,
  `ParseError`, `NodeId`;
- traces and tokens: `TraceMode`, `TraceEvent`, `TraceEventCallback`,
  `TraceResult`, `TraceSummary`, `Token`;
- extraction: `TextExtractionPolicy`, `TextExtractionOptions`,
  `VisibleTextExtractionOptions`, `TextContentExtractionOptions`,
  `TextExtractionResult`, `TextExtractionToken`, `TextProvenanceRange`;
- structural output: `Outline`, `OutlineEntry`, `Chunk`, `ChunkOptions`, `Edit`,
  `PatchPlan`, `PatchStep`;
- failures: `HtmlOperationalError`, `HtmlBudgetName`,
  `HtmlConfigurationErrorReason`, and `HtmlPatchPlanningReason`.

See [limits, errors, and safety](./limits-errors-and-safety.md) for option
semantics and [the data model](./data-model.md) for structural invariants.

## Runtime entry points

The npm entry point exposes the complete surface above. The current JSR entry
point shares parsing, serialization, extraction, namespace/attribute helpers,
namespace-aware query helpers, and operational errors, but does not yet expose
`getParseErrorSpecRef()`, `walk()`, `walkElements()`, `findById()`, `outline()`,
`chunk()`, `computePatch()`, or `applyPatchPlan()`.

JSR currently names its duplicated budget types `ParseBudgets`,
`ParseStreamBudgets`, and `TokenizeByteStreamEagerBudgets`. Treat these entry
point differences as current implementation facts, not a design pattern to
copy into new APIs.
