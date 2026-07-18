# Single-Pass Parsing Benchmark

This report records the performance and token-count evidence for removing the
standalone tokenizer pass from document and fragment parsing.

## Method

- Runtime: Node 24.14.0 on Linux x64 with `--expose-gc`.
- Each process used 40 warm-up iterations and nine measured samples.
- CPU is the median `process.cpuUsage()` time for the fixture workload.
- Heap is the median peak `heapUsed` increase from the post-GC sample start,
  sampled after every parse.
- The runner is `scripts/bench/run-single-pass-baseline.mjs`.
- Each baseline and its candidate comparison ran in consecutive isolated
  processes. Absolute results remain machine-specific; the comparisons are the
  relevant evidence.

The heap measurement captures observable per-parse retention and allocation
high-water marks. It does not claim to sample every transient allocation made
inside a parse.

## Token Counts

Logical token counts coalesce adjacent character chunks and include EOF.
Document counts remain unchanged across the empty, ASCII, multibyte, RCDATA,
and error-heavy fixtures. The textarea fragment changes from 5 to 2 because the
old count came from an unrelated Data-state tokenization; the new count comes
from the RCDATA tokenizer that builds the fragment.

| Fixture | `v0.1.1` | `8a7792a` | Single-pass candidate |
| --- | ---: | ---: | ---: |
| Empty document/fragment | 1 / 1 | 1 / 1 | 1 / 1 |
| ASCII document/fragment | 7 / 7 | 7 / 7 | 7 / 7 |
| Multibyte document/fragment | 4 / 4 | 4 / 4 | 4 / 4 |
| RCDATA document/textarea fragment | 5 / 5 | 5 / 5 | 5 / 2 |
| Error-heavy document/table fragment | 8 / 8 | 8 / 8 | 8 / 8 |

## Tagged `v0.1.1` Comparison

| Fixture | Baseline CPU ms | Candidate CPU ms | Change | Baseline heap bytes | Candidate heap bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| ASCII | 560.622 | 420.969 | -24.9% | 66,875,464 | 33,375,456 |
| Multibyte | 584.647 | 480.774 | -17.8% | 65,425,640 | 65,702,056 |
| Nested | 259.164 | 269.678 | +4.1% | 67,274,712 | 67,072,416 |
| Error-heavy | 484.217 | 514.561 | +6.3% | 67,130,704 | 67,345,880 |

## `8a7792a` Comparison

| Fixture | Baseline CPU ms | Candidate CPU ms | Change | Baseline heap bytes | Candidate heap bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| ASCII | 535.282 | 339.132 | -36.6% | 66,675,200 | 33,370,472 |
| Multibyte | 571.664 | 390.451 | -31.7% | 65,686,776 | 66,337,384 |
| Nested | 270.251 | 206.642 | -23.5% | 67,073,272 | 66,998,608 |
| Error-heavy | 444.546 | 352.589 | -20.7% | 67,092,704 | 67,280,800 |

The paired current-base run shows lower median CPU for every fixture. The
largest sampled heap reduction is the ASCII workload; other heap deltas stay
within roughly one percent, so they are treated as neutral rather than claimed
as improvements.
