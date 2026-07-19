# Trace Pipeline Evidence

This report records the reproducible complexity, byte-accounting, and returned
summary-size evidence for the trace pipeline. The public contract is documented
in [Options](../reference/options.md).

## Method

- Runtime: Node 24.14.0 on Linux x64 with `--expose-gc`.
- Each fixture uses two warmups and five measured samples; elapsed time is the
  median wall-clock value.
- The runner is `scripts/bench/run-trace-evidence.mjs`.
- Tagged `v0.1.1`, merged base `19bcc22`, and the candidate run in separate
  processes. Absolute timings are machine-specific; the growth ratios are the
  complexity evidence.
- Error-storm fixtures contain NUL characters and permit enough parse errors to
  generate one event per error. Returned heap includes the parsed result, so
  summary retention is proved by its serialized trace size, not total tree and
  diagnostics heap.

The multibyte fixture produces 14 events. Their individual canonical JSON forms
total 1,722 UTF-16 code units but 1,725 UTF-8 bytes. Controls enforce the exact
1,725-byte boundary and fail at 1,724 with `actual: 1,725`.

## Event-retention scaling

| Input code units | Events | `v0.1.1` ms | `19bcc22` ms | Candidate ms |
| ---: | ---: | ---: | ---: | ---: |
| 250 | 262 | 18.799 | 19.024 | 2.129 |
| 500 | 512 | 93.146 | 68.774 | 2.821 |
| 1,000 | 1,012 | 248.339 | 254.707 | 5.647 |
| 2,000 | 2,012 | 996.351 | 971.214 | 10.621 |

The prior implementation copied and re-serialized the complete retained array
for every append. Its larger fixtures approach four times the elapsed time when
events double. The candidate appends once and accounts only the new event; its
1,012-to-2,012-event elapsed ratio is 1.88.

## Summary retention

| Input code units | Observed events | Returned trace UTF-8 bytes |
| ---: | ---: | ---: |
| 250 | 262 | 393 |
| 1,000 | 1,012 | 398 |
| 4,000 | 4,012 | 398 |

Summary mode observes the complete pipeline while returning no event array.
The result has a fixed field set and a finite sorted set of event-kind names;
only scalar values and their digit widths vary. The 16x input/event increase
therefore leaves the returned trace at 398 bytes in the larger fixtures.

## Reproduction

Build the revision under test, then run:

```bash
node --expose-gc scripts/bench/run-trace-evidence.mjs \
  --module-root=. \
  --label=candidate \
  --revision=working-tree \
  --contract=current \
  --output=reports/trace-candidate.json
```

Historical revisions use `--contract=legacy`; the runner accepts their boolean
trace option and flat event-array result without changing those worktrees.
