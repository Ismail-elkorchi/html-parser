# Surface Map

This note records the current module-of-truth paths for published consumer surfaces.

- JSR root module: `jsr/mod.ts` (from `jsr.json` `exports["."]`)
- Node/TypeScript consumer root: `dist/mod.d.ts` (from `package.json` `types`)
- Node runtime import target: `dist/mod.js` (from `package.json` `exports["."].import`)

Node and JSR are versioned together but may expose different subsets. The four
HTML operational error classes (including cancellation), their structural guards, their reason/name
types (including `NodeId`), and `HtmlOperationalError` are deliberately exported
from both roots.
Both roots expose distinct non-stream and stream option types, the
`maxEncodingPrescanBytes` retention-cap name, and the promise-returning
`tokenizeByteStreamEager()` contract. Node calls the budget types
`ParseBudgetOptions` and `ParseStreamBudgetOptions`; JSR uses `ParseBudgets` and
`ParseStreamBudgets` while preserving identical fields and semantics.
Both roots return the same `ParsedDocument` shape from text, byte, and stream
full-document parsing, including optional exact decoded source plus encoding
and successful resource metadata. `parseFragment()` remains a direct
`FragmentTree` result. Text and fragment types exclude transport-only options.
Both roots also expose the same `TraceMode`, immutable event callback, summary,
and discriminated trace-result types. Event-retention budgets are accepted only
for `trace: "events"`.
Both roots expose `extractText()` and `iterateText()` with identical versioned
policy identities, required byte/token limits, immutable result and token
shapes, and range-based provenance. The visible-text policy additionally
requires bounded `noscript` fallback input and node limits. The removed eager
extraction helpers are not retained as aliases.
Both roots expose the exact namespace-aware element, attribute, doctype, and
span shapes; canonical namespace URI constants; HTML convenience attribute
helpers; and exact namespace query variants. JSR must not replace this union
with an optional-field approximation.
See `docs/reference/api-overview.md` for the current parity notes.
