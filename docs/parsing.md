# Parsing

## Already-decoded text

Use `parse()` when the input is already a JavaScript string. Because decoding
has already happened, encoding labels are neither accepted nor inferred.

```ts
import { parse } from "@ismail-elkorchi/html-parser";

const document = parse("<main lang=en>Hello</main>", {
  captureSpans: true,
  sourceRetention: "text"
});

console.log(document.sourceText);
console.log(document.metadata.encoding); // already-decoded
```

## Bytes

Use `parseBytes()` when the parser should perform HTML encoding sniffing and
decoding. A byte-order mark takes precedence; a recognized transport label or
`meta` declaration may otherwise select the encoding, followed by the HTML
default.

```ts
import { parseBytes } from "@ismail-elkorchi/html-parser";

const bytes = new TextEncoder().encode("<p>decoded bytes</p>");
const document = parseBytes(bytes, {
  transportEncodingLabel: "utf-8"
});

console.log(document.metadata.inputKind, document.metadata.encoding);
```

For a `ReadableStream<Uint8Array>`, use `parseStream()` and read
[streams and encoding](./streams-and-encoding.md).

## Fragments

`parseFragment()` interprets input in the parsing context of an external HTML,
SVG, or MathML element. The context is a descriptor, not a tag-name shortcut,
because namespace and selected attributes affect tokenization and tree
construction. It returns a `FragmentTree`, not a `ParsedDocument`, and does
not support source retention.

```ts
import {
  HTML_NAMESPACE_URI,
  parseFragment,
  serialize
} from "@ismail-elkorchi/html-parser";

const fragment = parseFragment("<tr><td>A<td>B", {
  namespaceUri: HTML_NAMESPACE_URI,
  localName: "tbody"
}, {
  budgets: { maxNodes: 32, maxDepth: 8 }
});

console.log(fragment.kind); // "fragment"
console.log(serialize(fragment));
```

The descriptor accepts `namespaceUri`, `localName`, and optional semantic
attributes shaped as `{ namespaceUri, localName, value }`. Use the exported
namespace constants. Prefixes and qualified names are derived, so conflicting
representations cannot be supplied. HTML context names are ASCII-lowercased;
SVG and MathML names retain case.

`ParseFragmentOptions` also records the external parsing environment:

- `scriptingMode` is `"inert"` by default or `"disabled"` for a document in
  which scripting is disabled;
- `documentMode` is `"no-quirks"` by default and may be `"limited-quirks"` or
  `"quirks"`; and
- `hasFormInContextChain` says whether the context itself or one of its
  ancestors is an HTML `form`.

These values are retained on the returned fragment. `serialize(fragment)` and
`chunk(fragment)` inherit its scripting mode; an explicit serialization option
still overrides it. Supply environment values from the real context document
when parity with browser `innerHTML` parsing matters.

## Parse diagnostics

Malformed HTML is normally recovered according to HTML parsing rules. The
result keeps non-fatal diagnostics in `tree.errors` or `fragment.errors`; each
entry has a stable `parseErrorId`, location data when available, and a short
message. `getParseErrorSpecRef()` maps a known identifier to its specification
reference on the npm surface.

Use thrown [operational errors](./limits-errors-and-safety.md#operational-errors)
for control flow. Do not treat a non-empty diagnostics array as an exception
unless your application policy explicitly requires rejection.

## Traces and source data

Set `trace: "summary"` for aggregate parser observations or `trace: "events"`
for an immutable event sequence. `onTraceEvent` observes events without
retaining them. Event retention limits only make sense in events mode.

Set `captureSpans: true` when nodes need source offsets. Also set
`sourceRetention: "text"` when later operations need the exact decoded input,
including structural patching. See the [data model](./data-model.md#source-spans).
