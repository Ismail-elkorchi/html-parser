# Data model

## Full documents and fragments

`parse()`, `parseBytes()`, and `parseStream()` return a frozen
`ParsedDocument`:

- `tree: DocumentTree` contains children, parse diagnostics, and optional trace;
- `sourceText: string | null` contains the exact decoded input only when
  `sourceRetention: "text"` was selected;
- `metadata: ParsedDocumentMetadata` records input kind, transport size,
  encoding evidence, and successful resource observations.

`parseFragment()` returns a frozen `FragmentTree` with its context tag,
children, diagnostics, and optional trace. It has no source-retention wrapper.

Resource observations describe the exact successful parse; they are not
limits and do not imply that budgets were enabled.

## Nodes

`HtmlNode` is a tagged union of:

- `ElementNode`: namespace URI, prefix, local and qualified names, attributes,
  and children;
- `TemplateContentNode`: the distinct document fragment owned by an HTML
  `template` element;
- `TextNode`: a text value;
- `CommentNode`: a comment value;
- `ProcessingInstructionNode`: a target and data retained from current HTML
  processing-instruction syntax;
- `DoctypeNode`: a name and discriminated external identifier.

Every tree and node has a parser-assigned numeric `NodeId`. Results, nodes,
attributes, spans, diagnostics, traces, and their arrays are frozen at runtime,
matching their readonly TypeScript types.

An element's identity is `(namespaceUri, localName)`. `tagName` is the
qualified name. Attributes similarly retain namespace URI, prefix, local name,
qualified name, and value. Use the exported HTML, SVG, MathML, XLink, XML, and
XMLNS namespace constants instead of copying URI strings.

For an HTML `template`, `children` is empty and `templateContent` owns a
`TemplateContentNode`. That fragment has its own `NodeId` and depth/resource
identity. Traversal and serialization follow the owned fragment; raw
`text-content-v1` extraction applied to the template element itself correctly
observes the element's empty DOM child list.

Doctype external ids distinguish no id, public id with an optional system id,
and system id. Empty strings are retained and differ from a missing value.

## Source spans

With `captureSpans: true`, source-backed nodes and attributes may have a
half-open `Span` measured in zero-based UTF-16 code units into the exact decoded
input. `spanProvenance` is:

- `"input"` when the span maps to source input;
- `"inferred"` for a parser-created node without a source slice;
- `"none"` when span capture was not available.

Source-aware patching additionally requires `sourceRetention: "text"`. See
[modifying HTML](./modifying-html.md).

## Diagnostics and traces

`ParseError` values are non-fatal HTML recovery diagnostics with stable ids.
Trace summary mode records constant-shape counters. Event mode adds an
immutable ordered event sequence. Token counts describe logical tokens
consumed by tree construction, coalesce adjacent character chunks, and include
EOF.

## Text results and patch plans

`TextExtractionResult` contains a retained UTF-8-safe prefix, the full output
byte count, a truncation flag, and the policy identity. `TextExtractionToken`
adds semantic token kind and coalesced source provenance ranges.

`PatchPlan` contains immutable slice and insertion steps plus the resulting
string. Its hidden source identity binds it to the originating parsed document.

The exact interfaces and helper groups are listed in [the API guide](./api.md).

## Serialization

Documents and fragments serialize their top-level children. Passing one
`HtmlNode` serializes that complete node representation. Text escaping follows
the node's namespace-aware parent: HTML raw-text parents emit literal data,
while ordinary, RCDATA, SVG, and MathML text is escaped. `noscript` follows the
serialization operation's scripting mode.

Serialization preserves the package's lossless public/system doctype model,
which is an intentional extension beyond the HTML fragment algorithm's
name-only doctype output. Serialization is deterministic, but arbitrary or
parser-recovered trees are not guaranteed to survive a serialize/reparse cycle
unchanged.
