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
| Do engine foundation units pass? | `npm run test:engine:unit` |
| Do character references match pinned data and fixtures? | `npm run test:engine:character-references` |
| Do tokenizer states match their assigned primary and holdout fixtures? | `npm run test:engine:tokenizer` |
| Do direct tree-model mutations and resource boundaries pass? | `npm run test:engine:tree` |
| Do assigned document cases and every fragment case match WPT trees and diagnostic views? | `npm run test:engine:tree-builder:conformance` |
| Do all compiled TypeScript runtime tests pass? | `npm run test:runtime` |
| Do compile-only API contracts pass? | `npm run test:types` |
| Do production behavior and regression tests pass? | `npm run test:behavior` |
| Does the normal local test set pass? | `npm test` |
| Does the complete maintained WPT tree snapshot pass its exact classifications? | `npm run qualification:wpt` |
| Does public serialization match pinned expectations and classified round trips? | `npm run qualification:serialization` |
| Does public serialization agree with Chromium, Firefox, and WebKit? | `npm run test:browser-diff:serialization` |
| Does the public fragment API match every pinned WPT fragment? | `npm run qualification:fragments` |
| Do public fragment contexts agree with Chromium, Firefox, and WebKit? | `npm run test:browser-diff:fragments` |
| Do documentation links and API names stay valid? | `npm run docs:check` |
| Do documented TypeScript examples compile strictly? | `npm run docs:snippets` |
| Do repository examples execute? | `npm run examples:run` |
| Is the packed npm artifact correct? | `npm run pack:check` |

All tests live under one `test` root. `test/behavior` owns public and current
production regressions, `test/engine` owns parser-engine units,
`test/contracts` owns compile-only positive and deliberate negative type
contracts, `test/support` owns fixture adapters/readers, and `test/fixtures`
owns checked-in data. Differential, fuzz, benchmark, and corpus-scale
conformance drivers stay in their matching `scripts` subdirectories because
they are executable test programs rather than Node test modules.

TypeScript runtime tests compile with `tsconfig.test-runtime.json` into the
disposable `tmp/test-runtime` tree before Node executes them. Type contracts use
the separate no-emit `tsconfig.type-tests.json`; keep `@ts-expect-error` cases
there, not in runtime tests. Compiled test output is deliberately absent from
package artifacts; private engine modules are shipped only because public
parsing imports them and are never exported as package entrypoints.

## Parser semantics

`npm run test:conformance` runs the pinned tokenizer, tree, encoding,
serializer, and currently named holdout suites. The tokenizer, tree, and
encoding adapters exercise the production parser. The serializer suite calls
the built package's public `serialize` export directly; it does not use a
test-only rendering implementation. Individual commands are available as
`test:tokenizer`, `test:tree`, `test:encoding`, `test:serializer`, and
`test:holdout`. The maintained WPT tree suite is separate because it runs the
complete snapshot, adversarial fragment chunks, and exact fingerprinted
classifications.

The aggregate command currently executes every partition, including holdout;
the label does not make those cases hidden. Treat all of its results as one
visible conformance signal. Corpus details and refresh constraints are in
[corpora.md](./corpora.md).

`npm run qualification:serialization` verifies the exact pinned WPT
serialization inventory, calls `dist/mod.js#serialize` for every applicable
expectation, requires the named positive round trips to remain structurally
stable, and checks exact fingerprints for the two intentional non-roundtrips.
The browser differential constructs equivalent native nodes; it is an oracle,
not an alternate serializer.

`npm run qualification:fragments` runs all 392 scripting variants of the 196
fragment cases in the pinned WPT tree snapshot through
`dist/mod.js#parseFragment`. It compares public trees and declared diagnostic
counts directly. The focused browser differential additionally constructs
HTML, SVG, MathML, integration-point, scripting, document-mode, and form-chain
contexts in native documents; accepted browser differences require exact tree
fingerprints and a standards-based reason.

Use `npm run test:fuzz` for generated parser inputs and
`npm run test:browser-diff` for browser comparisons. A difference is evidence
to investigate against the pinned standard and tests, not permission to copy
an oracle's behavior blindly.

## Resource and performance checks

- `npm run qualification:performance` is the single release performance
  report and gate, and release evaluation invokes it directly. It compares
  parsing with the accepted independent-parser
  revision, serialization with the first corrected public serializer revision,
  and retains tagged `v0.1.1` parsing as report-only recovery evidence. Samples
  are fresh-process and balanced across revisions; throughput and retained
  result memory use the same metric for every horizon.
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
