# Parse error taxonomy

This document defines the public parse-error identifier contract.

## Public fields
`ParseError` includes:
- `code`: high-level category (`PARSER_ERROR`, `BUDGET_EXCEEDED`, ...)
- `parseErrorId`: stable identifier string for parser errors
- `message`: implementation message
- `span` (when available)
- `nodeId` (when available)

Trace parse-error events include:
- `kind: "parseError"`
- `parseErrorId`
- `startOffset`
- `endOffset`

## Mapping strategy
- If the parser-provided code matches a WHATWG-style kebab-case identifier, it is exposed directly.
- Otherwise, it is namespaced as `vendor:<raw-code>`.
- Empty/invalid identifiers map to `vendor:unknown`.

This preserves deterministic diagnostics while keeping vendor-specific codes explicit.

## Spec reference helper
- `getParseErrorSpecRef(parseErrorId) -> string`
- Returns a stable WHATWG parse-errors section URL:
  - `https://html.spec.whatwg.org/multipage/parsing.html#parse-errors`

The helper intentionally does not generate per-row anchors.

## Diagnostics usage
- Use `parseErrorId` as the machine key for triage grouping and mismatch reporting.
- Use `getParseErrorSpecRef(...)` for human-facing links in logs and reports.

## Non-goals
- Full conformance checker behavior.
- Spec-claiming one-to-one mapping guarantees for every vendor-specific code.
