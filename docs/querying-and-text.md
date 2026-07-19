# Querying trees and extracting text

## Structural queries

The npm surface provides stack-safe traversal and query helpers. HTML-name
helpers are ASCII case-insensitive and only match elements in the HTML
namespace. Namespace-aware helpers use exact namespace URI and local-name
matching.

```ts
import {
  HTML_NAMESPACE_URI,
  findAllByAttr,
  findAllByTagNameNS,
  getAttributeValue,
  parse
} from "@ismail-elkorchi/html-parser";

const document = parse('<main><a class="primary" href="/docs">Docs</a></main>');
const links = [...findAllByTagNameNS(document.tree, HTML_NAMESPACE_URI, "a")];
const primary = [...findAllByAttr(document.tree, "class", "primary")];

console.log(links.length, primary.length, getAttributeValue(links[0]!, "href"));
```

Use `walk()` or `walkElements()` when a visitor is clearer, `findById()` for a
parser node id, and `findAllByTagName()`, `findAllByAttr()`,
`findAllByTagNameNS()`, or `findAllByAttrNS()` for filtered iteration.
`getAttributeValue()` and `hasAttribute()` target unnamespaced HTML attributes;
their `NS` variants target exact expanded names.

## Bounded text extraction

`extractText()` always requires output-byte and token limits. The result keeps
a scalar-safe prefix, the byte size of the complete policy output, and a
truncation flag.

```ts
import {
  VISIBLE_TEXT_HTML_POLICY,
  extractText,
  parse
} from "@ismail-elkorchi/html-parser";

const document = parse("<article><h1>Title</h1><p>Hello world.</p></article>");
const result = extractText(document.tree, {
  policy: VISIBLE_TEXT_HTML_POLICY,
  maxOutputBytes: 16_384,
  maxTokens: 1_024,
  maxFallbackInputBytes: 16_384,
  maxFallbackNodes: 1_024
});

console.log(result.text, result.totalBytes, result.truncated);
```

Choose a versioned policy deliberately:

- `TEXT_CONTENT_POLICY` (`"text-content-v1"`) concatenates descendant text
  nodes in tree order and only needs the shared output limits.
- `VISIBLE_TEXT_HTML_POLICY` (`"visible-text-html-v1"`) applies deterministic
  HTML-aware whitespace, structural-break, hidden-subtree, control-value, and
  `noscript` fallback rules. Its two fallback limits are required.

Visible-text extraction is not browser layout, rendered visibility, or an
accessibility-tree computation.

## Token and source provenance

`iterateText()` yields bounded semantic tokens and returns the same
`TextExtractionResult` when fully drained. Concatenating yielded `value` fields
reconstructs the retained `text`. Token byte offsets are half-open ranges in
the retained output's canonical UTF-8 encoding; coalesced provenance identifies
which parsed nodes contributed each range.

Iteration still measures the complete policy output after retention truncates,
so deadlines and cancellation remain active until the iterator is drained.

## Outlines and chunks

`outline()` produces heading/section entries with bounded entry text. `chunk()`
groups tree text by character, byte, and node limits for downstream consumers.
These are structural utilities, not semantic document segmentation or token
counting for a language model.
