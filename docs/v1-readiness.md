# v1 readiness

Generated: 2026-02-15

## Fixture results
- tokenizer (`reports/tokenizer.json`): passed `3647`, skipped `2479`, failed `0`, total `6126`
- tree (`reports/tree.json`): passed `0`, skipped `248`, failed `0`, total `248`
- encoding (`reports/encoding.json`): passed `77`, skipped `5`, failed `0`, total `82`
- serializer (`reports/serializer.json`): passed `38`, skipped `168`, failed `0`, total `206`
- release gate status (`reports/gates.json`): `allPass=true`

## Holdout results
- holdout suite (`reports/holdout.json`): passed `134`, skipped `122`, failed `0`, total `256`
- selection rule: `hash(id) % 10 === 0` with deterministic lexical ordering and limit `256`

## Browser differential summary
- report: `reports/browser-diff.json`
- corpus: `curated-v1`, seed `0x5f3759df`, cases `102`
- engine coverage: `chromium`
- compared `102`, agreed `102`, disagreed `0`
- normalization strategy ADR: `docs/decisions/ADR-003-browser-diff-normalization-v1.md`

## Cross-runtime versions snapshot
- Node: `v24.13.1`
- Deno: `2.6.9`
- Bun: `1.3.9`
- browser smoke: not required in release profile (see ADR-002)

## Dev dependency debt summary
- Current dev dependency ledger: `docs/debt.md`
- Gate/threshold realignment ADR: `docs/decisions/ADR-002-staged-threshold-realignment.md`
- Oracle normalization ADR: `docs/decisions/ADR-003-browser-diff-normalization-v1.md`
- Fixture skip ADRs:
  - `docs/decisions/ADR-001-tokenizer-conformance-skips.md`
  - `docs/decisions/ADR-001-tree-construction-conformance-skips.md`
  - `docs/decisions/ADR-001-serializer-conformance-skips.md`
  - `docs/decisions/ADR-001-encoding-malformed-meta-skips.md`

## Dataset pin summary
- pins are documented in `docs/spec-snapshots.md`
- html5lib-tests commit: `8f43b7ec8c9d02179f5f38e0ea08cb5000fb9c9e`
- entities hash: `sha256:d741d877ac77c4194c4ad526b5b4a19aef8dfe411ab840a466891cdbb9f362e6`

## Known limitations
- Tree-construction parity is incomplete and currently tracked through explicit skips.
- Serializer option parity is incomplete and currently tracked through explicit skips.
- Browser differential currently uses deterministic normalization fallback in non-browser environments.

## Next steps
1. Reduce tree-construction skips by implementing insertion-mode and error-recovery parity.
2. Reduce serializer skips by adding namespace and option handling parity.
3. Replace fallback browser differential execution with multi-engine real browser runs.
