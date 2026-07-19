# Third-party notices

Scope:
- This notice file covers all vendored runtime sources and vendored datasets currently used by this repository.
- First-party generated artifacts (for example `reports/*`) are not third-party materials.

## html5lib-tests
- Source: https://github.com/html5lib/html5lib-tests
- Location in repository: `vendor/html5lib-tests`
- License: MIT
- Notice: Fixture data is used for conformance evaluation.

## Web Platform Tests tree-construction fixtures
- Source: https://github.com/web-platform-tests/wpt
- Location in repository: `test/fixtures/upstream/wpt-tree-construction`
- License: BSD-3-Clause
- Notice: A test-only, offline snapshot of the maintained HTML
  tree-construction fixtures. Exact commit, upstream paths, Git blob IDs,
  SHA-256 values, and byte counts are recorded in the colocated `manifest.json`.

## WHATWG named character references
- Source: https://html.spec.whatwg.org/entities.json
- Location in repository:
  `test/fixtures/upstream/whatwg-named-character-references`
- License: CC BY 4.0; incorporated source-code portions are also available under
  BSD-3-Clause, as stated in the colocated WHATWG license.
- Notice: The exact test/generator input, license, rendered-standard snapshot
  identity, retrieval date, SHA-256 values, byte counts, and schema counts are
  recorded in the colocated `manifest.json`. The generated first-party table is
  excluded from published packages while the independent engine is incomplete.

## parse5 runtime source (vendored subset)
- Source: https://github.com/inikulin/parse5
- Location in repository: `src/internal/vendor/parse5`
- License: MIT
- Notice: Vendored parser/tokenizer runtime subset used to keep production artifacts self-contained.

## entities runtime source (vendored subset)
- Source: https://github.com/fb55/entities
- Location in repository: `src/internal/vendor/entities`
- License: BSD-2-Clause
- Notice: Vendored entity decoder subset used by the vendored tokenizer runtime.

Exact source versions, registry artifacts, upstream and local SHA-256 values,
and the responsibilities of the three local patches are recorded in
[`legacy-runtime-manifest.json`](./legacy-runtime-manifest.json).
