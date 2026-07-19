# Conformance corpora

## Current pin

`vendor/html5lib-tests` is a Git submodule pinned at
`8f43b7ec8c9d02179f5f38e0ea08cb5000fb9c9e`. Current runners consume its
tokenizer, tree-construction, encoding, and serializer fixtures. Normal tests
must use the local pin and must not fetch from the network.

Initialize a fresh checkout with:

```bash
git submodule update --init --recursive
```

The upstream html5lib-tests project now directs maintained HTML
tree-construction tests to
[Web Platform Tests](https://github.com/web-platform-tests/wpt/tree/master/html/syntax/parsing/resources).
Do not update the existing submodule blindly: a newer revision can remove tree
files that current runners still consume.

## Migration rule

Before replacing or updating the current tree corpus:

1. pin an exact WPT commit and preserve its license;
2. record upstream paths and hashes for imported fixtures;
3. run the maintained WPT `.dat` cases offline through one test-support parser;
4. list every intentionally inapplicable case with a concrete reason;
5. demonstrate equal or greater applicable coverage than the current pin;
6. only then remove or narrow the old tree fixtures.

Tokenizer, encoding, and serializer fixtures may remain pinned separately if
html5lib-tests remains their authoritative home. Fixture decoding and output
normalization belong in test support, never in production parser behavior.

Prefer a checked-in, test-only snapshot of the required WPT data over another
large submodule. A refresh command may use the network when invoked explicitly;
ordinary build and test commands must remain deterministic and offline.

## Ownership and provenance

The HTML and Encoding standards own parser and decoder semantics. WPT and
html5lib provide authoritative conformance cases within their stated scope.
Product regressions cover html-parser-specific budgets, errors, spans, traces,
immutability, and public API behavior.

Store licenses and corpus provenance with test fixtures and summarize them in
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). Do not describe a test
partition as private or holdout unless normal contributors truly cannot see or
run it.
