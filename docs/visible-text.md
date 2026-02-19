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
- `noscript` fallback handling:
  - when `noscript` is parsed as a single raw-text node containing markup, the raw text is reparsed as a fragment and extracted with the same visible-text rules.
- Subtrees are skipped when:
  - the element has `hidden`
  - the element has `aria-hidden="true"` (also accepts empty and `"1"` as true)

## Structural break rules
- `&lt;br&gt;` contributes a line break (`\n`).
- `&lt;p&gt;` contributes a paragraph break (`\n\n`) after paragraph content.
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
- `&lt;img alt="..."&gt;` contributes non-empty `alt`.
- `&lt;input&gt;` contributes non-empty `value`, except `type="hidden"`.
- `&lt;button&gt;` contributes `value` when present; otherwise text children contribute.

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
- `case-045`: `nav` + `article` + `footer` block boundary extraction for link-heavy page chrome.
- `case-046`: figure image-alt emission followed by figcaption text and trailing paragraph break.
- `case-047`: nested list traversal preserving deterministic paragraph separation.
- `case-048`: table header/data tabs with explicit `&lt;br&gt;` line breaks inside cells.
- `case-049`: paragraph + `pre` adjacency preserving preformatted newlines.
- `case-050`: linked image-alt text fusion with surrounding inline copy.
- `case-051`: hidden input suppression with visible input/button value extraction.
- `case-052`: `aria-hidden=\"1\"` subtree suppression in sectioned content.
- `case-053`: details/summary linearization with deterministic line-break boundaries.
- `case-054`: script exclusion with trailing `noscript` fallback paragraph.
- `case-055`: template subtree exclusion with body-only visibility.
- `case-056`: inline SVG + MathML token adjacency before paragraph boundaries.
- `case-057`: `head` metadata/link/canonical suppression with body text-only output.
- `case-058`: linked image without `alt` does not emit placeholder text.
- `case-059`: `aria-hidden=\"true\"` suppression for foreign-content icon subtrees.
- `case-060`: `head` preload/script suppression plus hidden-input exclusion with visible input value.
- `case-061`: challenge-page style `noscript` fallback markup extraction.
- `case-062`: `noscript` raw markup reparse with nested `style` suppression.
- `case-063`: `noscript` raw markup reparse preserving `&lt;br&gt;`, table row, and cell boundaries.

## Determinism
For identical input trees and options:
- `visibleText` output is byte-stable.
- `visibleTextTokens` sequence and token values are stable.

## Non-goals
- Browser pixel/layout parity.
- CSS box-model visibility computation.
- Full browser `innerText` parity.
