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
- `includeAccessibleNameFallback`: `false`
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
- Accessible-name fallback (optional):
  - enabled only when `includeAccessibleNameFallback=true`
  - applies only to `input` elements
  - uses only non-empty `aria-label`
  - ignores `title` for fallback emission
  - does not emit fallback text for `a` or `button`

Fallback fixture coverage (`test/fixtures/visible-text-fallback/v1`) includes:
- anchor/button fallback non-emission
- input `aria-label` fallback emission
- hidden and `aria-hidden` subtree suppression with fallback enabled
- `input value` precedence over fallback
- mixed-control deterministic output with fallback enabled

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
- `case-064`: empty `iframe` with `src` does not emit renderer placeholder text.
- `case-065`: `iframe` fallback text contributes when explicit fallback nodes exist.
- `case-066`: `meta http-equiv="refresh"` and `title` inside `head` remain non-visible.
- `case-067`: alternate/canonical `link` metadata remains non-visible while body nav text extracts.
- `case-068`: button content with icon-only image emits button text and no image placeholder.
- `case-069`: button `value` takes precedence over child text for control-value extraction.
- `case-070`: `aria-hidden=""` subtree suppression keeps only visible sibling content.
- `case-071`: `hidden` subtree suppression with sectioned page chrome.
- `case-072`: hidden subtree suppresses nested `iframe` fallback text.
- `case-073`: challenge-style `noscript` fallback with nested `iframe` emits only visible message text.
- `case-074`: head-only metadata/script/style suppression with body control-value extraction.
- `case-075`: link-heavy inline navigation text extraction without renderer list markers.
- `case-076`: dense inline language-link clusters preserve deterministic adjacency semantics.
- `case-077`: list-based language switcher extraction keeps per-item paragraph boundaries.
- `case-078`: mixed heading + inline language toggles before block heading content.
- `case-079`: icon-only link with image `alt` plus adjacent inline nav link sequence.
- `case-080`: icon-without-alt suppression plus footer block-boundary extraction.
- `case-081`: nested nav and aside regions with deterministic inline adjacency and block breaks.
- `case-082`: form-control extraction with label text + input/button value precedence.
- `case-083`: `aria-hidden` language switcher suppression with visible public navigation.
- `case-084`: iframe fallback text retention followed by paragraph boundary extraction.
- `case-085`: button value precedence and icon-alt contribution in adjacent controls.
- `case-086`: canonical/alternate link metadata in body remains non-visible.
- `case-087`: punctuation-separated inline nav rails stay deterministic.
- `case-088`: status-review phrasing in document lifecycle sections remains deterministic across nested headings.
- `case-089`: button value extraction remains explicit; aria-label-only buttons do not emit synthetic text.
- `case-090`: media-link icon handling distinguishes empty `alt` from explicit `alt`, plus button value controls.
- `case-091`: numbered table-of-contents rails preserve numeric tokens and heading flow.
- `case-092`: anchor elements without text content remain non-emitting even with `aria-label`/`title` attributes.
- `case-093`: keyboard-hint text extraction keeps visible instructions while suppressing `aria-hidden` duplicates.
- `case-094`: table row/tab boundaries stay deterministic when status cells mix button values and button text.
- `case-095`: language-switcher extraction excludes hidden mega-menu branches while keeping visible locales.
- `case-096`: explicit prose and control values are emitted without inferring CSS background-image metadata.
- `case-097`: `noscript` fallback reparse keeps visible fallback prose while suppressing nested style payloads.
- `case-098`: icon-link `alt` contribution composes with adjacent rail separators and inline navigation labels.
- `case-099`: reference-link numeric ordering remains deterministic for dense nav rails.

## Determinism
For identical input trees and options:
- `visibleText` output is byte-stable.
- `visibleTextTokens` sequence and token values are stable.

## Non-goals
- Browser pixel/layout parity.
- CSS box-model visibility computation.
- Full browser `innerText` parity.
