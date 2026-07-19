# Data Model

## Parse Output Shape

`parse` and `parseBytes` return a `DocumentTree`:
- `kind: "document"`
- `children: HtmlNode[]`
- `errors: ParseError[]`
- optional `trace: TraceResult`, containing either a constant-shape summary or
  that summary plus an immutable event sequence

`parseFragment` returns a `FragmentTree` with the same structure but `kind: "fragment"`.

The trace summary's `tokenCount` and the retained token event report the number
of logical tokens emitted to the tree builder, coalescing adjacent character
chunks and including EOF. Fragment token counts reflect the supplied fragment
context.

## Core Node Types

`HtmlNode` is a tagged union:

- `element`: `namespaceUri`, `prefix`, `localName`, qualified `tagName`,
  `attributes`, and `children`
- `text`: `value`
- `comment`: `value`
- `doctype`: `name` and a discriminated `externalId`

Element identity is the tuple `(namespaceUri, localName)`. `tagName` is the
qualified name and includes `prefix` when the parser supplies one. HTML parsing
does not resolve arbitrary element prefixes, so `prefix` is normally `null`;
a colon remains part of `localName` unless the parser provides a real prefix.

Attributes expose `namespaceUri` (nullable), `prefix` (nullable), `localName`,
qualified `name`, and `value`. Adjusted foreign attributes therefore retain
identities such as XLink `href`, XML `lang`, and XMLNS `xlink` instead of
collapsing to an unqualified name.

Canonical namespace constants are exported as `HTML_NAMESPACE_URI`,
`SVG_NAMESPACE_URI`, `MATHML_NAMESPACE_URI`, `XLINK_NAMESPACE_URI`,
`XML_NAMESPACE_URI`, and `XMLNS_NAMESPACE_URI`.

`DoctypeNode.externalId` is one of:

- `{ kind: "none" }`
- `{ kind: "public", publicId, systemId }`, where `systemId` may be `null`
- `{ kind: "system", systemId }`

Empty strings are retained and are distinct from a missing identifier.

When spans are enabled, nodes expose `span` and `spanProvenance`. Span offsets
are zero-based UTF-16 code units into the exact decoded input, with inclusive
`start` and exclusive `end`. Element spans cover the represented source markup;
attribute spans cover the complete source attribute syntax. Parser-inferred
nodes have `spanProvenance: "inferred"` and no `span`.

## Traversal

Use `walk`, `walkElements`, `findById`, `findAllByTagName`, and
`findAllByAttr` for structural queries. The tag and attribute convenience
queries operate only on HTML elements and compare unnamespaced HTML names with
ASCII case-insensitive semantics. Use `findAllByTagNameNS` or
`findAllByAttrNS` for exact namespace/local-name matching.

Use `getAttributeValue` and `hasAttribute` for unnamespaced HTML attributes.
Use `getAttributeValueNS` and `hasAttributeNS` for exact expanded names. These
helpers and the namespace constants are available from both Node/npm and JSR.

Traversal, query, serialization, outline, text extraction, patch indexing, and
chunking use explicit stacks, so a tree accepted by the configured depth budget
does not depend on the JavaScript call-stack limit.

## Serialization

`serialize(documentOrNode)` emits normalized HTML text from a parsed tree or
node subtree. It emits correct `PUBLIC` and `SYSTEM` document type syntax and
applies HTML void-element rules only in the HTML namespace. Foreign elements
whose local names happen to be `source`, `param`, or another HTML void name keep
their children and closing tags.

## Errors And Budgets

- Non-fatal parser issues are returned in `errors` with stable `parseErrorId` values.
- Budget violations throw `HtmlBudgetExceededError`.
- Invalid options and required arguments throw `HtmlConfigurationError`.
- Patch planning/application failures throw `HtmlPatchPlanningError`.
- Stream acquisition/read failures throw `HtmlStreamReadError` with the
  original failure as `cause`.

Budget controls live in `ParseOptions.budgets` and hard-stop input/decoded
bytes, parser node/depth/error/attribute allocation, trace retention, and
elapsed work at the first unavailable unit.
