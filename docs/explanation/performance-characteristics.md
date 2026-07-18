# Performance Characteristics

The parser is optimized for deterministic behavior, predictable memory bounds, and stable results across runtimes.

Key characteristics:
- A single parse5 pass with parser-phase node, depth, error, and attribute hard
  stops.
- Byte decoding checks decoded UTF-8 output before retaining fixed-size chunks.
- Stream encoding prescan retention is bounded independently from input and
  decoded-output limits. The complete decoded document is still retained before
  parsing; configure `maxDecodedUtf8Bytes` to bound it.
- Monotonic deadline and abort checkpoints cover decoding, tree construction,
  public conversion, serialization, traversal, and extraction. A stream
  deadline also interrupts a pending read.
- Deterministic serialization and traversal helpers.

Benchmark and profiling commands:

```bash
npm run test:bench
npm run test:bench:stability
npm run test:bench:hard-budgets
```

The hard-budget benchmark runs node, attribute, parse-error, decoded-output,
and trace storms in isolated paired processes. It verifies exact first-failure values and
lower retained heap for bounded work; see the
[maintainer evidence](../maintainers/hard-budget-evidence.md).
