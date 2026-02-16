# Ecosystem comparison (scope and capability matrix)

This document compares `html-parser` with adjacent tools using the same dimensions:
- correctness
- portability
- dependencies
- streaming
- rewrite primitives
- determinism
- trace
- budgets
- supply-chain posture

Labels:
- **Provides**: capability is part of the project surface.
- **Does not provide**: capability is not part of the project surface.
- **Out of scope**: project addresses a different problem class.

## html-parser (this repository)
- correctness: **Provides** standards-oriented parser conformance gates.
- portability: **Provides** Node/Deno/Bun/browser runtime support with Web APIs.
- dependencies: **Provides** zero runtime dependency policy (`dependencies: {}`).
- streaming: **Provides** `parseStream` and `tokenizeStream` over `ReadableStream<Uint8Array>`.
- rewrite primitives: **Provides** span-based deterministic patch planning and application.
- determinism: **Provides** deterministic IDs, serialization, chunking, and evaluation checks.
- trace: **Provides** bounded structured trace events for parser execution.
- budgets: **Provides** structured budget enforcement (`BudgetExceededError`).
- supply-chain posture: **Provides** runtime self-containment and dist import gates.

## parse5
- correctness: **Provides** HTML parsing aligned to HTML parsing algorithms.
- portability: **Provides** JavaScript runtime portability.
- dependencies: **Does not provide** zero-runtime-dependency policy for this repository.
- streaming: **Provides** parser/tokenizer usage patterns, but not this repository's Web-Streams-first agent API contract.
- rewrite primitives: **Does not provide** span-indexed patch planning primitives.
- determinism: **Does not provide** this repository's deterministic NodeId/agent output contract.
- trace: **Does not provide** bounded agent trace schema as a primary API.
- budgets: **Does not provide** structured budget controls by default.
- supply-chain posture: **Out of scope** for this repository's gate policy.

## htmlparser2
- correctness: **Out of scope** for full HTML5 tree-construction parity goals.
- portability: **Provides** JavaScript runtime usage.
- dependencies: **Does not provide** zero-runtime-dependency policy for this repository.
- streaming: **Provides** streaming parser usage.
- rewrite primitives: **Does not provide** deterministic patch-plan primitives.
- determinism: **Does not provide** this repository's determinism contract.
- trace: **Does not provide** bounded parser trace schema for agent debugging.
- budgets: **Does not provide** structured budget errors by default.
- supply-chain posture: **Out of scope** for this repository's gate policy.

## cheerio
- correctness: **Out of scope** (query/manipulation API over parser-oracle conformance gates).
- portability: **Provides** Node-focused runtime usage.
- dependencies: **Does not provide** zero-runtime-dependency policy for this repository.
- streaming: **Does not provide** Web Streams parser/token stream APIs.
- rewrite primitives: **Provides** DOM-style mutation, **does not provide** minimal slice/insert patch plans.
- determinism: **Does not provide** deterministic NodeId + gate-backed output contract.
- trace: **Does not provide** parser execution trace schema.
- budgets: **Does not provide** structured parse budgets.
- supply-chain posture: **Out of scope** for this repository's gate policy.

## jsdom
- correctness: **Provides** DOM emulation scope, **out of scope** for this repository's parser-only objective.
- portability: **Does not provide** this repository's cross-runtime Web-API-first posture.
- dependencies: **Does not provide** zero-runtime-dependency policy for this repository.
- streaming: **Does not provide** parser token stream API for agent workflows.
- rewrite primitives: **Provides** DOM mutation, **does not provide** deterministic patch-plan surface.
- determinism: **Does not provide** this repository's deterministic parser contract.
- trace: **Does not provide** bounded parser trace schema.
- budgets: **Does not provide** structured parser budgets by default.
- supply-chain posture: **Out of scope** for this repository's gate policy.

## linkedom
- correctness: **Out of scope** for this repository's conformance-gated parser objective.
- portability: **Provides** JavaScript runtime usage.
- dependencies: **Does not provide** zero-runtime-dependency policy for this repository.
- streaming: **Does not provide** this repository's parser/token stream APIs.
- rewrite primitives: **Provides** DOM mutation, **does not provide** span-indexed patch plans.
- determinism: **Does not provide** this repository's deterministic parser gates.
- trace: **Does not provide** bounded parser trace schema.
- budgets: **Does not provide** structured parser budgets by default.
- supply-chain posture: **Out of scope** for this repository's gate policy.

## deno-dom
- correctness: **Out of scope** for this repository's parser conformance gate system.
- portability: **Provides** Deno runtime usage; not the full Node/Deno/Bun/browser target matrix.
- dependencies: **Does not provide** zero-runtime-dependency policy for this repository.
- streaming: **Does not provide** this repository's Web Streams parser/token APIs.
- rewrite primitives: **Does not provide** deterministic patch-plan primitives.
- determinism: **Does not provide** this repository's determinism contract.
- trace: **Does not provide** bounded parser trace schema.
- budgets: **Does not provide** structured parser budget controls.
- supply-chain posture: **Out of scope** for this repository's gate policy.

## HTMLRewriter / lol-html
- correctness: **Provides** streaming rewrite engine behavior; **out of scope** for full parser tree API parity.
- portability: **Provides** platform-specific integration (for example Workers/Bun surfaces), but not this repository's general parser portability contract.
- dependencies: **Out of scope** for this repository's zero-runtime-dependency package policy.
- streaming: **Provides** streaming transformation.
- rewrite primitives: **Provides** rewrite capabilities, **does not provide** this repository's span-indexed deterministic patch-plan API.
- determinism: **Does not provide** this repository's parser determinism gate model.
- trace: **Does not provide** this repository's bounded parser trace schema.
- budgets: **Does not provide** this repository's structured parser budget API.
- supply-chain posture: **Out of scope** for this repository's gate policy.
