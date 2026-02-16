# Agent-visible-text v1

This document defines the deterministic text extraction contract for coding-agent workflows.

API:
- `visibleText(nodeOrTree, options?) -> string`
- `visibleTextTokens(nodeOrTree, options?) -> ReadonlyArray<VisibleTextToken>`

Input:
- `DocumentTree`
- `FragmentTree`
- `HtmlNode`

## Options and defaults
- `skipHiddenSubtrees`: `true`
- `includeControlValues`: `true`
- `trim`: `true`

## Node contribution rules
- Text nodes contribute text.
- Comment and doctype nodes do not contribute.
- Element subtrees are skipped for:
  - `head`
  - `script`
  - `style`
  - `template`
- Subtrees are skipped when:
  - the element has `hidden`
  - the element has `aria-hidden="true"` (also accepts empty and `"1"` as true)

## Structural break rules
- `<br>` contributes a line break (`\n`).
- `<p>` contributes a paragraph break (`\n\n`) after paragraph content.
- Table rows (`tr`) contribute line breaks.
- Table cells (`td`/`th`) are separated with a tab (`\t`) within each row.
- Block break tags are treated as structural boundaries:
  - `address`, `article`, `aside`, `blockquote`, `div`, `dl`, `fieldset`, `figcaption`, `figure`, `footer`, `form`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `header`, `li`, `main`, `nav`, `ol`, `section`, `table`, `tbody`, `thead`, `tfoot`, `ul`

## Whitespace normalization
- Newline normalization: `\r\n` and `\r` normalize to `\n`.
- Outside `pre` and `textarea`:
  - consecutive ASCII whitespace (`space`, `tab`, `LF`, `CR`, `FF`) collapses to a single space.
- Inside `pre` and `textarea`:
  - spaces and newlines are preserved.
- Post-processing:
  - repeated paragraph separators are reduced to at most one blank line (`\n\n`).
  - surrounding spaces around line breaks are removed.
  - output is trimmed when `trim=true`.

## Attribute-derived text
- `<img alt="...">` contributes non-empty `alt`.
- `<input>` contributes non-empty `value`, except `type="hidden"`.
- `<button>` contributes `value` when present; otherwise text children contribute.

## Token contract
`visibleTextTokens` emits a stable ordered union:
- `{ kind: "text", value: string }`
- `{ kind: "lineBreak", value: "\n" }`
- `{ kind: "paragraphBreak", value: "\n\n" }`
- `{ kind: "tab", value: "\t" }`

`visibleText(nodeOrTree, options)` equals `visibleTextTokens(nodeOrTree, options).map((t) => t.value).join("")`.

## Coverage additions
The v1 fixture corpus includes synthetic reproductions for downstream mismatch triage patterns:
- `case-033`: `script` exclusion with trailing `noscript` fallback text.
- `case-034`: leading `noscript` parsed outside visible body surface.
- `case-035`: `hidden` subtree suppression around `noscript`.
- `case-036`: `aria-hidden="true"` subtree suppression around `noscript`.
- `case-037`: SVG `title` + `text` adjacency without implicit separator.
- `case-038`: SVG adjacency followed by block-level paragraph boundary.
- `case-039`: MathML `mi/mo/mi` operator retention (`+`) in text output.
- `case-040`: MathML adjacent `mi` nodes without implicit separator.
- `case-041`: SVG and MathML adjacent text flow in a single inline sequence.
- `case-042`: paragraph break interactions around inline SVG content.
- `case-043`: table cell tab boundaries with SVG/MathML cell payloads.
- `case-044`: `noscript` subtree containing foreign content before visible paragraph text.

## Determinism
For identical input trees and options:
- `visibleText` output is byte-stable.
- `visibleTextTokens` sequence and token values are stable.

## Non-goals
- Browser pixel/layout parity.
- CSS box-model visibility computation.
- Full browser `innerText` parity.
