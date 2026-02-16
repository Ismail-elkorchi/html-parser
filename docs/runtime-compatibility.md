# Runtime compatibility

This document lists the runtime Web APIs required by library code under `src/`.

## Required APIs
- `Uint8Array`
- `TextDecoder`
- `ReadableStream` and stream reader methods
- `Promise`
- `URL` (ESM module runtime)

## Compatibility assumptions
- Node runtime provides Web Streams and Encoding APIs.
- Deno runtime provides Web Streams and Encoding APIs.
- Bun runtime provides Web Streams and Encoding APIs.
- Modern evergreen browsers provide these APIs natively.

## Packaging implications
- Runtime code is ESM only.
- Runtime code does not import Node builtin modules.
- Runtime code does not require external runtime dependencies.
