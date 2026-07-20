# Conformance corpora

All normal tests run from local, checksum-verified data. They never fetch
fixtures from the network.

## Named character reference data

The independent engine's generated reference table comes from the pinned
WHATWG snapshot under
`test/fixtures/upstream/whatwg-named-character-references`. Its manifest keeps
the floating `entities.json` retrieval artifact, the rendered HTML Standard
snapshot, and the WHATWG license as separate URL/byte/SHA-256 identities. The
rendered snapshot identifier is not described as a `whatwg/html` Git commit.

Normal generation and verification are offline:

```bash
npm run character-references:generate
npm run character-references:check
npm run test:engine:character-references
```

The refresh command requires reviewed local candidate files and independently
fetches their fixed upstream URLs. It writes only the local candidates after
both copies match the supplied SHA-256 values, their schemas agree, and the
rendered standard's complete table matches the JSON. It also requires an
explicit retrieval date and immutable standard/license revisions. Stage and
inspect the three files outside the repository first, then run:

```bash
npm run character-references:refresh -- \
  --entities-file=<reviewed-entities-json> \
  --entities-bytes=<expected-entities-bytes> \
  --entities-sha256=<expected-entities-sha256> \
  --license-file=<reviewed-whatwg-license> \
  --license-bytes=<expected-license-bytes> \
  --license-revision=<whatwg-html-git-commit> \
  --license-sha256=<expected-license-sha256> \
  --retrieved-at=<yyyy-mm-dd> \
  --standard-file=<reviewed-rendered-snapshot> \
  --standard-bytes=<expected-rendered-snapshot-bytes> \
  --standard-revision=<rendered-snapshot-id> \
  --standard-sha256=<expected-rendered-snapshot-sha256>
```

Never accept a newly downloaded hash merely because the command observed it.
Review the changed raw data, manifest counts and composite table hash, generated
table, license, and focused conformance results together.

## Maintained tree-construction corpus

The checked-in WPT snapshot under
`test/fixtures/upstream/wpt-tree-construction` is pinned to commit
`e4ea1706fa708c3ac4523c534a65160d1ab20db8`. Its manifest records the official
repository, upstream paths, Git blob IDs, SHA-256 values, licenses, byte counts,
and expected inventory.

Run the complete snapshot with:

```bash
npm run qualification:wpt
```

The runner expands cases without a scripting marker into script-on and
script-off variants and evaluates all 3,828 document and fragment executions.
Fragment inputs run both whole and one-UTF-16-unit chunk schedules. Exact
fingerprinted classifications live in
`test/fixtures/qualification/wpt-tree-classifications.json`; an outcome whose
fingerprint or reason changes fails instead of becoming a silent skip.

The current snapshot contains 61 `.dat` files, 470,005 fixture bytes, 1,934
base cases, and 3,828 scripting variants. Of those variants:

- 3,802 match the pinned expected tree and diagnostic contract exactly;
- 22 retain exact classifications for pinned-versus-current standards drift;
  and
- four require live DOM mutation or `document.write` and are inapplicable to a
  static parser-library harness.

Every classified variant appears in `reports/engine-wpt-tree.json` with its
exact ID and reason. Files whose names contain `unsafe` remain applicable:
their NUL, CR, and other raw input is preserved by the shared `.dat` reader.

## html5lib corpus

`vendor/html5lib-tests` remains a Git submodule at
`8f43b7ec8c9d02179f5f38e0ea08cb5000fb9c9e`. It supplies tokenizer,
encoding, serializer, and six-file tree conformance. Initialize it
when running those suites:

```bash
git submodule update --init --recursive
```

All 277 tree cases were proven represented in the maintained WPT snapshot when
that snapshot was pinned. Do not update, remove, or narrow the html5lib
submodule until its tokenizer, encoding, serializer, and tree consumers have an
authoritative replacement.

The tokenizer runner expands the 14 tokenizer files to 7,036 entry-mode cases
and applies the same visible primary/holdout partition. It matches 6,297
primary and 701 holdout
cases. The other 38 cases exercise processing instructions and retain stale
comment-token expectations from before the pinned HTML Standard added its five
processing-instruction states. They are classified by the observed standard
behavior, not fixture IDs; direct tests cover the typed token, recovery, and
diagnostics. `npm run test:engine:tokenizer` also requires every token, source
span, and diagnostic to agree under whole-input, one-UTF-16-unit,
Unicode-scalar, delimiter, empty-interleaved, and deterministic chunk schedules,
plus every code-unit partition of focused transition probes.

## Refresh procedure

Refreshing the WPT snapshot is an explicit maintenance operation. Pass a full
40-character WPT commit:

```bash
npm run wpt-tree:refresh -- --commit=<wpt-commit>
```

The command fetches only when invoked. For an already checked-out WPT tree at
the same commit, add `--source=/absolute/path/to/wpt`. It replaces only the
test snapshot and regenerates the provenance manifest.

After a refresh:

1. inspect the upstream commit and license;
2. review added, removed, scripted, raw, and foreign-fragment cases;
3. investigate every changed outcome against the pinned and current standard;
4. update exact classification IDs, reasons, and fingerprints only for reviewed
   script requirements or standards drift;
5. run `npm run qualification:wpt` and inspect
   `reports/engine-wpt-tree.json`; and
6. rerun the full checks and confirm normal tests remain offline.

Fixture decoding and expected-output formatting belong in test support, never
in production parser behavior.

## Ownership and provenance

The HTML and Encoding standards own parser and decoder semantics. WPT and
html5lib provide authoritative conformance cases within their stated scope.
Product regressions cover html-parser-specific budgets, errors, spans, traces,
immutability, and public API behavior.

Store licenses and corpus provenance with test fixtures and summarize them in
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). A test partition is not
private merely because it is called holdout; all repository partitions are
visible and runnable.
