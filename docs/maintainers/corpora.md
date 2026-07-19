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
npm run test:wpt-tree
```

The runner expands cases without a scripting marker into script-on and
script-off variants. It reports a visible `current-primary` and
`current-holdout` partition, verifies two consecutive results are identical,
and compares the result fingerprint with the checked-in legacy-engine
baseline. Tree-output conformance and parse-error-count evidence are reported
separately because the WPT browser harness ignores the `.dat` error sections.

The current snapshot contains 61 `.dat` files, 470,005 fixture bytes, 1,934
base cases, and 3,828 scripting variants. Of those variants:

- 3,690 execute through the current string-parser facade;
- 134 are applicable but explicitly reported as unsupported because the
  legacy fragment API cannot express an SVG or MathML context element; and
- four are inapplicable to a static parser-library harness because they require
  live DOM mutation or `document.write`.

Every non-executed variant appears in `reports/wpt-tree.json` with its exact ID
and reason. Files whose names contain `unsafe` remain applicable: their NUL,
CR, and other raw input is preserved by the shared `.dat` reader.

## Legacy corpus retained during migration

`vendor/html5lib-tests` remains a Git submodule at
`8f43b7ec8c9d02179f5f38e0ea08cb5000fb9c9e`. It still supplies tokenizer,
encoding, serializer, and the previous six-file tree corpus. Initialize it
when running those suites:

```bash
git submodule update --init --recursive
```

The live coverage comparison proves that all 277 previous tree cases are
represented in the WPT snapshot:

```bash
npm run test:wpt-tree:coverage
```

The inputs, contexts, and scripting requirements match. WPT has three updated
expected trees in `tests1.dat` for processing-instruction handling. This is
recorded standards drift; the corpus-only change does not alter production
parser behavior.

Do not update, remove, or narrow the html5lib submodule until the consumer
suites have been assigned another authoritative pin and the live comparison
still proves no coverage loss.

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
3. run `npm run test:wpt-tree:coverage`;
4. inspect `reports/wpt-tree.json`, especially every skip and semantic change;
5. update the result baseline only after accepting the evidence:

   ```bash
   npm run build
   node scripts/conformance/run-wpt-tree-fixtures.mjs \
     --require-legacy-coverage --update-baseline
   ```

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
