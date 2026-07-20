# Third-party notices

Scope:
- This notice file covers the third-party test corpora and standards datasets used by this repository.
- First-party generated artifacts (for example `reports/*`) are not third-party materials.

## html5lib-tests
- Source: https://github.com/html5lib/html5lib-tests
- Locations in repository: `test/fixtures/upstream/html5lib-tokenizer` and
  `test/fixtures/upstream/html5lib-encoding`
- License: MIT
- Notice: Test-only tokenizer and applicable encoding snapshots are used for
  conformance evaluation. Their exact commit, upstream paths, Git blob IDs,
  SHA-256 values, and byte counts are recorded in colocated manifests.

## Web Platform Tests tree-construction fixtures
- Source: https://github.com/web-platform-tests/wpt
- Location in repository: `test/fixtures/upstream/wpt-tree-construction`
- License: BSD-3-Clause
- Notice: A test-only, offline snapshot of the maintained HTML
  tree-construction fixtures. Exact commit, upstream paths, Git blob IDs,
  SHA-256 values, and byte counts are recorded in the colocated `manifest.json`.

## Web Platform Tests serialization fixtures
- Source: https://github.com/web-platform-tests/wpt
- Location in repository: `test/fixtures/upstream/wpt-serialization`
- License: BSD-3-Clause
- Notice: A test-only, offline snapshot of the complete HTML serialization test
  directory and its shared element-list dependency. Exact commit, upstream
  paths, applicability, Git blob IDs, SHA-256 values, and byte counts are
  recorded in the colocated `manifest.json`.

## WHATWG named character references
- Source: https://html.spec.whatwg.org/entities.json
- Location in repository:
  `test/fixtures/upstream/whatwg-named-character-references`
- License: CC BY 4.0; incorporated source-code portions are also available under
  BSD-3-Clause, as stated in the colocated WHATWG license.
- Notice: The exact test/generator input, license, rendered-standard snapshot
  identity, retrieval date, SHA-256 values, byte counts, and schema counts are
  recorded in the colocated `manifest.json`. A deterministic first-party
  generator produces the private runtime lookup table from that snapshot.
