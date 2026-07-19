# Bounded Text-Extraction Evidence

This note records the semantic, output-retention, provenance, and nested
fallback evidence for the public text-extraction surface. The consumer contract
is in the [options reference](../reference/options.md).

## Contract

`extractText()` and `iterateText()` require one exact policy identity:

- `visible-text-html-v1` preserves the versioned visible-text fixture corpus;
- `text-content-v1` concatenates descendant text nodes in tree order.

Both policies require finite non-negative safe-integer `maxOutputBytes` and
`maxTokens` limits. Visible extraction also requires
`maxFallbackInputBytes` and `maxFallbackNodes`. The result is the frozen exact
shape `{ text, totalBytes, truncated, policy }`; iterator tokens and their
coalesced provenance ranges are frozen as well.

The retained text is a canonical UTF-8 byte prefix that never splits an
ECMAScript string-iterator code point. `totalBytes` remains the exact size of
the complete policy output after either retention cap is reached. Provenance
uses half-open retained-output byte ranges instead of per-character objects.

## Method

- Runtime: Node 24.14.0 on Linux x64 with `--expose-gc`.
- Baseline: merged revision `878fffe`.
- Candidate runner: `scripts/bench/run-text-extraction-evidence.mjs`.
- Candidate measurements use one warm-up extraction followed by nine measured
  samples. The parsed public tree remains live across each before/after forced
  collection, so the delta concerns extraction-owned retained data rather than
  the tree.
- The focused control suite also checks all 112 visible-text snapshots,
  policy variants, raw extraction, exact UTF-8 totals, scalar-safe boundaries,
  iterator/result parity, option validation, fallback limits, cancellation,
  deadlines, provenance identity, and deferred whitespace.

Run the resource evidence with:

```bash
npm run test:bench:text-extraction
```

## Provenance Retention

The baseline expanded one 250,000-character text contribution into one source
object per string-iterator value and retained about 52,880,328 additional heap
bytes while returning one token.

The candidate ran the same 250,000-character contribution with a 1,024-byte
output cap. Every sample returned exactly 1,024 bytes, measured the complete
250,000-byte output, reported truncation, and retained one token with one
provenance range. The median forced-GC heap delta was -3,816 bytes, with samples
from -8,672 to 4,304 bytes. That small signed interval is treated as garbage
collector noise, not as negative allocation; importantly, no character-count
scaled retained structure remained observable.

Deferred visible-policy whitespace was a related hidden path. Leading,
trailing, and pre-newline source runs are now capped by `maxOutputBytes` while
omitted byte counts remain exact. A focused 50,000-character alternating
space/tab case proves that leading and trailing trim results remain
untruncated, while an interior or untrimmed case returns the bounded prefix and
the exact complete byte total.

## Nested Fallback Deadline

On the baseline, a 20,000-element HTML `noscript` fallback exceeded a nominal
1 ms deadline only after about 924.751 ms because the nested fragment parse did
not share the extraction controls.

Across nine candidate samples, the same fixture failed with
`BUDGET_EXCEEDED` / `maxTimeMs` in a median 1.045 ms (range 1.041-1.200 ms).
The nested parse also enforces the required fallback input-byte and node caps,
inherits cancellation, and reports fallback-specific public budget names. Its
provenance maps back to the owning source `noscript` node rather than temporary
fragment node IDs.

## Consumer Implications

A crawler can pass its byte-named text limit directly as `maxOutputBytes`, read
`totalBytes` without materializing omitted output, and use the policy ID in
stored extraction metadata. A terminal browser can select the raw policy for
its existing renderer-owned display rules and consume iterator tokens when it
does not need a joined string. Neither consumer needs a UTF-16 slicing helper
at the parser boundary.

All manifest versions remain `0.1.1`.
