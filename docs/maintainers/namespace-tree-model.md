# Namespace Tree Model And Deep-Stack Evidence

## Contract

Parsed element and attribute identity is represented explicitly as namespace
URI, nullable prefix, local name, and qualified name. Canonical namespace URI
constants are shared by the Node/npm and JSR entrypoints. HTML convenience
queries use ASCII case-insensitive matching only for HTML elements and
unnamespaced attributes; namespace variants compare namespace URI and local
name exactly.

Document type external identifiers use a discriminated union. The public
serializer emits the matching `PUBLIC` or `SYSTEM` syntax, retains explicit
empty strings, and refuses manually constructed identifiers containing both
quote delimiters because no lossless quoted HTML representation exists.

HTML void-element behavior is conditional on the HTML namespace. An SVG or
MathML element whose local name is `source`, `param`, or another HTML void name
retains its children and closing tag.

## Hidden paths investigated

The initial public conversion, metrics, serialization, `textContent`, visible
text, and traversal paths were recursive. Related inspection found the same
failure mode in:

- parse5 select-adoption recovery;
- parse5-to-internal and internal-to-public conversion;
- internal fixture normalization and tree serialization;
- outline collection;
- patch node/span indexes; and
- chunk node counting.

Each path now uses an explicit work stack while retaining source child order,
preorder public traversal, and deterministic postorder public node-ID
assignment.

## Regression proof

`test/control/namespaces-stack.test.js` covers:

- HTML, SVG, MathML, XLink, XML, and XMLNS identity;
- HTML convenience matching and exact namespace queries;
- full adjusted-attribute source spans;
- missing, PUBLIC, SYSTEM, and explicit-empty doctype round trips;
- SVG elements with HTML void local names;
- UTF-16 half-open source offsets and inferred-node provenance;
- parsing and operating on 5,000 nested elements; and
- 3,200-level internal normalization, internal serialization, and patch
  indexing.

The accepted-depth test exercises serialization, traversal, outline,
`textContent`, visible-text extraction and provenance, queries, and chunking on
both parsed and caller-built trees. The prior implementation threw `RangeError`
while parsing 3,000 nested elements and independently overflowed each tested
operation on a 5,000-level caller-built tree.

Run the focused proof with:

```bash
npm run test:control
```

Run the broader parser and runtime gates with the commands in
[`release-validation.md`](./release-validation.md).
