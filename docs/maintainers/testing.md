# Testing

Install from the lockfile. All conformance corpora are checked in and normal
tests do not fetch fixture data:

```bash
npm ci
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
| Do engine foundation units pass? | `npm run test:engine:foundations` |
| Do character references match pinned data and fixtures? | `npm run test:engine:character-references` |
| Does the tokenizer match the complete pinned corpus? | `npm run test:engine:tokenizer` |
| Do direct tree-model mutations and resource boundaries pass? | `npm run test:engine:tree` |
| Do all compiled TypeScript runtime tests pass? | `npm run test:runtime` |
| Do compile-only API contracts pass? | `npm run test:types` |
| Do production behavior and regression tests pass? | `npm run test:behavior` |
| Do repository tooling and corpus readers pass? | `npm run test:tooling` |
| Does the normal local test set pass? | `npm test` |
| Does the complete maintained WPT tree snapshot pass its exact classifications? | `npm run qualification:wpt` |
| Does public serialization match pinned expectations and classified round trips? | `npm run qualification:serialization` |
| Does public document parsing agree with Chromium, Firefox, and WebKit? | `npm run oracle:documents` |
| Does public serialization agree with Chromium, Firefox, and WebKit? | `npm run oracle:serialization` |
| Does the public fragment API match every pinned WPT fragment? | `npm run qualification:fragments` |
| Do public fragment contexts agree with Chromium, Firefox, and WebKit? | `npm run oracle:fragments` |
| Do documentation links and API names stay valid? | `npm run docs:check` |
| Do documented TypeScript examples compile strictly? | `npm run docs:snippets` |
| Do repository examples execute? | `npm run examples:run` |
| Is the packed npm artifact complete, self-contained, and type-safe? | `npm run qualification:package` |

All tests live under one `test` root. `test/behavior` owns public and current
production regressions, `test/engine` owns parser-engine units,
`test/contracts` owns compile-only positive and deliberate negative type
contracts and consumer projects, `test/tooling` owns tests of repository
scripts and corpus readers, `test/support` owns shared fixture adapters, and
`test/fixtures` owns checked-in data. Behavior and tooling directories contain
only discoverable `*.test.js` modules; their runner rejects other files instead
of silently ignoring them. Differential, fuzz, benchmark, and corpus-scale
conformance drivers stay in their matching `scripts` subdirectories because
they are executable test programs rather than Node test modules.

TypeScript runtime tests compile with `tsconfig.test-runtime.json` into the
disposable `tmp/test-runtime` tree before Node executes them. Type contracts use
the separate no-emit `tsconfig.type-tests.json`; keep `@ts-expect-error` cases
there, not in runtime tests. Compiled test output is deliberately absent from
package artifacts; private engine modules are shipped only because public
parsing imports them and are never exported as package entrypoints.

## Parser semantics

`npm run test:conformance` runs every applicable case in the pinned tokenizer
and encoding corpora, the complete public serializer suite, and the maintained
WPT tree-construction snapshot. The tokenizer and encoding adapters exercise
the production parser. The serializer suite calls the built package's public
`serialize` export directly; it does not use a test-only rendering
implementation. Individual commands are available as `test:tokenizer`,
`test:encoding`, `test:serializer`, and `qualification:wpt`. WPT is the sole
tree-construction authority and its qualification covers all document and
fragment cases, adversarial fragment chunks, and exact fingerprinted
classifications. Corpus details and refresh constraints are in
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

Use `npm run qualification:fuzz` for generated parser inputs and the
`oracle:*` commands for browser comparisons. A difference is evidence
to investigate against the pinned standard and tests, not permission to copy
an oracle's behavior blindly.

## Resource and performance checks

- `npm run qualification:performance` is the single release performance
  report and gate, and release qualification invokes it directly. It compares
  parsing with the accepted independent-parser
  revision, serialization with the first corrected public serializer revision,
  and retains tagged `v0.1.1` parsing as report-only recovery evidence. Samples
  are fresh-process and balanced across revisions; throughput and retained
  result memory use the same metric for every horizon.
- `npm run qualification:resources` compares bounded and unbounded parser work
  in isolated processes and requires every limit to fail at its first
  unavailable unit while retaining less heap.
- `npm run qualification:mutation` requires every configured mutation to be
  killed; invalid or surviving mutations fail the command.

Do not commit generated benchmark or mutation JSON as documentation. Record a
stable regression threshold in its test or benchmark configuration; keep
one-off measurements in the pull request that used them.

## Broader gates

`npm run qualification:ci` runs the complete local correctness, conformance,
cross-runtime, browser-smoke, and package-artifact gates. `npm run
qualification:release` adds public serialization and fragment qualification,
three-browser oracles, fuzzing, resource and mutation checks, supply-chain
evidence, and cross-revision performance. Both profiles fail at the first
failed command and retain diagnostic reports under `reports/`; they do not
assign an artificial quality score.
