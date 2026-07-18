# Hard-Budget Resource Evidence

This report validates that parser resource limits stop adversarial work during
the allocating phase rather than after a complete parse.

## Method

- Runtime: Node 24.14.0 on Linux x64 with explicit garbage collection.
- Each bounded and unbounded fixture runs in a fresh process.
- Fixture construction completes before an explicit GC and the pre-parse heap
  sample, so input ownership is excluded from the retained-heap delta.
- Retained heap is sampled immediately after synchronous return or throw.
- Peak resident memory is the process `maxRSS` high-water mark. This captures
  native and JavaScript process memory but is intentionally not described as a
  parser-only allocation sample.
- The executable runner is `scripts/bench/run-hard-budget-evidence.mjs`; normal
  test runs write ignored evidence under `reports/`. Refresh the reviewed
  machine-readable snapshot explicitly with
  `--output=docs/maintainers/hard-budget-evidence.json`.

## Results

Every bounded run reported the deterministic first unavailable unit and
retained less heap than the paired unbounded run.

| Fixture | Deterministic bounded outcome | Compared resource evidence |
| --- | --- | --- |
| Node storm | `maxNodes` 128, actual 129 | retained heap and peak RSS |
| Attribute storm | `maxAttributesPerElement` 128, actual 129 | retained heap and peak RSS |
| Parse-error storm | `maxParseErrors` 128, actual 129 | retained heap and peak RSS |
| Decoded-output storm | `maxDecodedUtf8Bytes` 65,536, actual 65,537 | retained heap and peak RSS |
| Trace storm | `maxTraceEvents` 128, actual 129 | retained heap and peak RSS |

Heap and RSS measurements are machine- and run-specific, so the generated JSON
is the numerical source of truth. The runner fails unless every bounded
retained-heap value is lower than its paired unbounded value.

The focused control suite separately proves bounded stream reads, reader
cancellation/lock release, stalled-read deadlines, duplicate and oversized
attribute construction, exact Unicode decoded-byte limits, zero limits, and
configuration rejection before reader acquisition.
