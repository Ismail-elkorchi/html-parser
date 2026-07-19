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
- `npm run mutation:pilot` writes a disposable report under `reports/`.

Do not commit generated benchmark or mutation JSON as documentation. Record a
stable regression threshold in its test or benchmark configuration; keep
one-off measurements in the pull request that used them.

## Broader gates

`npm run eval:ci` and `npm run eval:release` aggregate additional quality,
conformance, smoke, and packaging reports. Reports are diagnostic artifacts,
not a substitute for checking whether the tests express the right contract.
Run Deno, Bun, and browser smoke commands when changing portable entry points
or runtime-sensitive behavior.
