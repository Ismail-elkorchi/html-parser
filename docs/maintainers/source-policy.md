# Independent parser source policy

The parser is an independent standards-based implementation. It
must not copy, translate, import, or adapt parse5, entities, or another HTML
parser implementation.

Do not call the work formally “clean-room” unless a separately reviewed
two-role isolation process and appropriate legal review are actually in place.
Earlier repository history exposed maintainers to a third-party implementation,
so this repository does not claim that formal process.

## Allowed implementation sources

- [HTML Living Standard parsing algorithms](https://html.spec.whatwg.org/multipage/parsing.html)
- [WHATWG named character reference data](https://html.spec.whatwg.org/entities.json)
- [Encoding Living Standard](https://encoding.spec.whatwg.org/) and its
  [encoding-label data](https://encoding.spec.whatwg.org/encodings.json)
- Infra, DOM, and Unicode standards where HTML or Encoding depends on them
- html-parser public types, user documentation, and accepted product regression
  tests for package-specific contracts

Pin the exact HTML and Encoding revisions used by the maintained engine.
Living standards change; update the normative baseline as an explicit,
reviewable change.

Authoritative tests may come from WPT, html5lib-tests, product regressions, and
black-box results from standards-conforming browsers. Preserve exact snapshot
provenance and licenses. Black-box results can reveal a difference but cannot
supply an implementation algorithm.

## Prohibited implementation sources

When maintaining the parser engine, do not inspect, search, diff, copy,
translate, or derive code from:

- parser-library source formerly removed from this repository;
- third-party parser source, declarations, source maps, internal algorithm docs,
  generated distributions, or Git history;
- htmlparser2, jsdom, browser-engine parser source, or another parser
  implementation;
- generated output obtained by translating or decompiling another engine, or
  patches that expose its algorithms.

The production engine must not import, share tokenizer/tree-builder paths with,
or fall back to another parser implementation.

## Resolving disagreements

1. Reduce the behavior to one deterministic fixture.
2. Record the exact standard anchor and test snapshot.
3. Decide whether the question is parser semantics or a package-specific
   contract.
4. Check current WPT and multiple browser engines when the standard remains
   ambiguous.
5. Classify and test the conclusion; do not preserve historical behavior merely
   because it is historical.

If prohibited source is exposed accidentally, stop any formal clean-room claim
and record what was exposed before deciding whether independent implementation
work can continue. Do not reproduce long specification passages in source;
encode the invariant and link a stable standards anchor.
