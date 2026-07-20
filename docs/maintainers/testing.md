# Testing

Install from the lockfile and initialize the conformance corpus once:

```bash
npm ci
git submodule update --init --recursive
```

## Everyday changes

Run `npm run check:fast`. It covers linting, production and test TypeScript
compilation, behavior and engine tests, type contracts, required documentation
checks, JSR documentation quality, and repository examples.

Use narrower commands while iterating:

| Question | Command |
| --- | --- |
| Do owned sources satisfy lint rules? | `npm run lint` |
| Do production TypeScript sources compile? | `npm run typecheck` |
| Does the package build? | `npm run build` |
| Do independent-engine foundation units pass? | `npm run test:engine:unit` |
| Do independent character references match pinned data and fixtures? | `npm run test:engine:character-references` |
| Do isolated tokenizer states match their assigned primary and holdout fixtures? | `npm run test:engine:tokenizer` |
| Do direct tree-model mutations and resource boundaries pass? | `npm run test:engine:tree` |
| Do assigned document cases and every fragment case match WPT trees and diagnostic views? | `npm run test:engine:tree-builder:conformance` |
| Do all compiled TypeScript runtime tests pass? | `npm run test:runtime` |
| Do compile-only API contracts pass? | `npm run test:types` |
| Do production behavior and regression tests pass? | `npm run test:behavior` |
| Does the normal local test set pass? | `npm test` |
| Does the maintained WPT tree snapshot reproduce its frozen result? | `npm run test:wpt-tree` |
| Does WPT retain every legacy tree case? | `npm run test:wpt-tree:coverage` |
| Do documentation links and API names stay valid? | `npm run docs:check` |
| Do documented TypeScript examples compile strictly? | `npm run docs:snippets` |
| Do repository examples execute? | `npm run examples:run` |
| Is the packed npm artifact correct? | `npm run pack:check` |

All tests live under one `test` root. `test/behavior` owns public and current
production regressions, `test/engine` owns replacement-engine units,
`test/conformance` owns focused fixture-adapter behavior, `test/contracts`
owns compile-only positive and deliberate negative type contracts,
`test/support` owns fixture adapters/readers, and `test/fixtures` owns checked-in
data. Differential, fuzz, benchmark, and corpus-scale conformance drivers stay
in their matching `scripts` subdirectories because they are executable test
programs rather than Node test modules.

TypeScript runtime tests compile with `tsconfig.test-runtime.json` into the
disposable `tmp/test-runtime` tree before Node executes them. Type contracts use
the separate no-emit `tsconfig.type-tests.json`; keep `@ts-expect-error` cases
there, not in runtime tests. The incomplete engine and compiled test output are
deliberately absent from package artifacts.

## Parser semantics

`npm run test:conformance` runs the legacy-pinned tokenizer, tree, encoding,
serializer, and currently named holdout suite. Individual commands are
available as `test:tokenizer`, `test:tree`, `test:encoding`, `test:serializer`,
and `test:holdout`. The maintained WPT tree suite is separate because its
frozen report intentionally exposes legacy-engine conformance gaps while
failing only on unexplained corpus, determinism, coverage, or baseline drift.

The aggregate command currently executes every partition, including holdout;
the label does not make those cases hidden. Treat all of its results as one
visible conformance signal. Corpus details and refresh constraints are in
[corpora.md](./corpora.md).

Use `npm run test:fuzz` for generated parser inputs and
`npm run test:browser-diff` for browser comparisons. A difference is evidence
to investigate against the pinned standard and tests, not permission to copy
an oracle's behavior blindly.

## Resource and performance checks

- `npm run test:bench` runs the normal benchmark set.
- `npm run test:bench:stability` checks benchmark variation.
- `npm run test:bench:hard-budgets` exercises first-failure resource behavior.
- `npm run test:bench:text-extraction` exercises bounded extraction.
- `npm run test:bench:character-references` records generated-table lookup,
  import-heap, and million-digit numeric-reference evidence.
- `npm run test:bench:engine-tokenizer` records isolated tokenizer throughput,
  heap delta, token fingerprints, and deterministic resource counters across
  character references, markup, text end tags, and processing instructions.
- `npm run test:bench:engine-tree` records isolated deep and wide direct-tree
  construction, traversal, validation, heap, and resource evidence.
- `npm run test:bench:engine-tree-builder` records immediate parsing for deep,
  whitespace-boundary-heavy, error-heavy, table, foster-parent, template,
  foreign-content, and fragment inputs, including exact contextual step and
  fragment node-budget failures.
- `npm run test:bench:engine-formatting` records indexed Noah-family handling,
  full reconstruction, repeated adoption, and first-unavailable-step evidence.
- `npm run test:browser-diff:engine-formatting` compares focused independent
  formatting/recovery trees with every locally available browser engine.
- `npm run test:browser-diff:engine-contextual` compares focused table,
  template, relaxed-select, and frameset trees. Accepted browser lag is tied to
  exact normalized-tree fingerprints so a different disagreement still fails.
- `npm run test:browser-diff:engine-foreign-fragment` compares namespace,
  adjustment, integration-point, CDATA, and fragment-context trees. Known
  browser differences are likewise accepted only by exact fingerprints backed
  by the pinned WPT result.
- `npm run mutation:pilot` writes a disposable report under `reports/`.
- `npm run test:bench:engine-tree-builder` includes repeated selectedcontent
  replacement so detached clone generations and parser-pop work remain visible
  in the same resource/heap evidence as the other tree-construction paths.

Do not commit generated benchmark or mutation JSON as documentation. Record a
stable regression threshold in its test or benchmark configuration; keep
one-off measurements in the pull request that used them.

## Broader gates

`npm run eval:ci` and `npm run eval:release` aggregate additional quality,
conformance, smoke, and packaging reports. Reports are diagnostic artifacts,
not a substitute for checking whether the tests express the right contract.
Run Deno, Bun, and browser smoke commands when changing portable entry points
or runtime-sensitive behavior.
