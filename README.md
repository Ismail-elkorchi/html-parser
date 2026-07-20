# @ismail-elkorchi/html-parser

A standards-oriented HTML parser with explicit resource limits, structural
queries, source-aware edits, and bounded text extraction.

This repository documents current development. Published packages are
available from
[npm](https://www.npmjs.com/package/@ismail-elkorchi/html-parser) and
[JSR](https://jsr.io/@ismail-elkorchi/html-parser); use the README and
TypeScript declarations shipped with the version you install. The project is
pre-1.0, so minor releases may contain intentional breaking changes.

## Use it when

- you need an immutable, namespace-aware HTML tree rather than a browser DOM;
- input can be untrusted and work must be constrained by explicit budgets;
- you need deterministic traversal, serialization, text extraction, or
  source-preserving edits across Node.js, Deno, Bun, and browsers.

It does not execute scripts, compute layout or accessibility trees, or sanitize
HTML. Sanitize separately before rendering parser output.

## Install

```bash
npm install @ismail-elkorchi/html-parser
```

```bash
deno add jsr:@ismail-elkorchi/html-parser
```

## Quick start

```ts
import {
  findAllByTagName,
  parse
} from "@ismail-elkorchi/html-parser";

const document = parse("<main><h1>Hello</h1><p>World</p></main>");
const [heading] = findAllByTagName(document.tree, "h1");

console.log(document.tree.kind); // "document"
console.log(heading?.localName); // "h1"
console.log(document.tree.errors); // non-fatal HTML parse diagnostics
```

Full-document entry points return a `ParsedDocument`:

```txt
ParsedDocument
├── tree        immutable document tree and non-fatal parse errors
├── sourceText  decoded input when source retention was requested
└── metadata    input, encoding, and observed resource usage
```

`parseFragment()` returns a `FragmentTree` directly and requires an explicit
namespace-aware context:

```ts
import { HTML_NAMESPACE_URI, parseFragment } from "@ismail-elkorchi/html-parser";

const rows = parseFragment("<tr><td>A<td>B", {
  namespaceUri: HTML_NAMESPACE_URI,
  localName: "tbody"
});
```

## Find what you need

- [Get started](./docs/getting-started.md)
- [Parse documents, bytes, and fragments](./docs/parsing.md)
- [Read streams and handle encodings](./docs/streams-and-encoding.md)
- [Query trees and extract text](./docs/querying-and-text.md)
- [Modify source HTML safely](./docs/modifying-html.md)
- [Set limits and handle errors](./docs/limits-errors-and-safety.md)
- [Understand the data model](./docs/data-model.md)
- [Browse API groups](./docs/api.md)

The [documentation index](./docs/index.md) also points maintainers to the
architecture, testing, corpus, and source-policy notes.

## Runtime support

The npm surface supports Node.js 20, 22, and 24. Deno, Bun, and evergreen
browsers are covered by smoke tests. npm/Node and JSR expose the same runtime
and TypeScript API, documented in [the API guide](./docs/api.md).

## Safety

All limits are opt-in: no parser budget is enabled by default. For untrusted
input, set limits appropriate to the containing request, pass an `AbortSignal`,
and classify operational failures with the exported structural error guards.
See [limits, errors, and safety](./docs/limits-errors-and-safety.md).

## Dependencies and implementation

No external runtime packages are installed: the npm `dependencies` field is
empty and JSR imports only repository-owned modules. The parser is an
independent standards-based TypeScript implementation; generated character
reference data is reproducible from the pinned WHATWG snapshot. Provenance and
implementation-source rules are recorded in the
[source policy](https://github.com/Ismail-elkorchi/html-parser/blob/main/docs/maintainers/source-policy.md) and
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Support and contributing

Use [SUPPORT.md](./SUPPORT.md) for usage questions and bug reports. Start code
contributions with the repository's
[contribution guide](https://github.com/Ismail-elkorchi/html-parser/blob/main/CONTRIBUTING.md).
Report vulnerabilities
through the private channel in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
