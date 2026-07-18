# Stream Buffering Evidence

This report validates the byte-stream API's observable timing, encoding-prescan
retention, chunk-pattern parity, and retained-heap behavior. It is contract
evidence, not a claim that full-document parsing is incremental.

## Method

- Runner: `scripts/bench/run-stream-buffer-baseline.mjs`
- Runtime: Node 24.14.0 on Linux x64 with explicit garbage collection
- Revisions: tagged `v0.1.1` at `d4b0b69`, merged base `7625931`, and candidate
  commit `5983a3e` based on `7625931`
- Timing/heap fixture: 262,179 transport bytes in 4,096-byte chunks, three
  warmups and seven measured samples
- Retained heap: median `heapUsed` after the returned tree/token collection is
  retained, minus the explicit-GC starting heap
- Raw workspace artifacts:
  `reports/stream-buffer-v0.1.1.json`,
  `reports/stream-buffer-7625931.json`, and
  `reports/stream-buffer-candidate.json`

Run a candidate measurement with:

```bash
npm run build
node --expose-gc scripts/bench/run-stream-buffer-baseline.mjs \
  --module-root=. \
  --label=candidate \
  --revision=<commit> \
  --output=reports/stream-buffer-candidate.json
```

## Contract observations

| Revision | Result before EOF | First token after EOF | Two-byte prescan cap | One/seven/oversized chunk parity |
| --- | --- | --- | --- | --- |
| tagged `v0.1.1` | unsettled | `startTag` | throws the retired chunk-dependent `maxBufferedBytes` failure | parse and tokens match |
| `7625931` | unsettled | `startTag` | returns; retained high-water is 2 bytes | parse and tokens match |
| candidate | unsettled | `startTag` | returns; stream trace reports retained/effective limit as 2/2 bytes | parse and tokens match |

The permanent controls also cover a zero-byte prescan cap, the 16,384-byte
default/implementation maximum, values larger than that maximum, exact decoded
UTF-8 budget boundaries, Windows-1252 decoding, cancellation, reader release,
and invalid configuration before reader acquisition.

## Resource observations

| Revision | Parse median elapsed | Parse retained heap | Tokenize median elapsed | Tokenize retained heap |
| --- | ---: | ---: | ---: | ---: |
| tagged `v0.1.1` | 85.432 ms | 60,390,608 B | 32.921 ms | 28,874,192 B |
| `7625931` | 66.467 ms | 33,428,128 B | 42.016 ms | 29,341,456 B |
| candidate `5983a3e` | 61.658 ms | 33,439,264 B | 39.602 ms | 29,339,496 B |

The candidate stays effectively flat in retained heap against its merged base
while making the retention and EOF contracts explicit. These measurements do
not include an upstream producer's queue and do not substitute for the hard
transport, decoded-output, tree, trace, and deadline controls.

The [WHATWG HTML encoding-sniffing algorithm](https://html.spec.whatwg.org/multipage/parsing.html#determining-the-character-encoding)
encourages a 1,024-byte prescan but permits the user agent to choose its efficient
end condition. The parser therefore retains its existing 16,384-byte
implementation maximum and exposes that effective limit precisely instead of
presenting the prescan cap as a total-stream failure.
