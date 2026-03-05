# Performance Characteristics

The parser is optimized for deterministic behavior, predictable memory bounds, and stable results across runtimes.

Key characteristics:
- Linear parse flow with explicit budget checks.
- Streaming APIs support bounded buffering.
- Deterministic serialization and traversal helpers.

Benchmark and profiling commands:

```bash
npm run test:bench
npm run test:bench:stability
```
