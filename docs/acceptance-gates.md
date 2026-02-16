# Acceptance gates (definition of “best”)

This document is the single operational definition of “best HTML parser in TypeScript”.
A parser qualifies as “best” only if it passes ALL gates in the chosen profile
and then achieves the highest composite score under `evaluation.config.json`.

Profiles:
- `ci`: day-to-day enforcement (no holdouts, browser diff optional, Node+Deno+Bun smoke required)
- `release`: release enforcement (holdouts required, browser diff required)

Artifacts pinned by:
- `docs/spec-snapshots.md`
- `evaluation.config.json`

## Score model (profile-weighted)

Evaluation runs are hermetic:
- `scripts/eval/run-eval.mjs` executes `scripts/eval/clean-reports.mjs` before any report writer.
- Stale report artifacts from earlier runs are removed before scoring.

Evaluation scoring uses profile-specific weights from `evaluation.config.json`:
- `profiles.ci.weights`
- `profiles.release.weights`

Each profile weight set sums to exactly `100`.

CI weights (current):
- `correctness`: 70
- `browserDiff`: 0
- `performance`: 0
- `robustness`: 10
- `agentFirst`: 15
- `packagingTrust`: 5

Release weights (current):
- `correctness`: 40
- `browserDiff`: 20
- `performance`: 15
- `robustness`: 10
- `agentFirst`: 10
- `packagingTrust`: 5

---

## Gate set: CI profile (must pass)

### G-000: Evaluation configuration exists
Requirement:
- `evaluation.config.json` exists and is valid JSON.

---

### G-010: Zero runtime dependencies
Requirement:
- `package.json` MUST NOT contain runtime dependencies.
- `dependencies` is an empty object (`{}`).

Evidence:
- `package.json`

---

### G-012: No external imports in build output
Requirement:
- Compiled ESM files under `dist/` MUST NOT contain bare package import specifiers.
- Relative specifiers, absolute paths, `node:` builtins, and URL imports are allowed by syntax;
  bare package imports are rejected.

Evidence:
- `reports/no-external-imports.json` with `ok=true`

---

### G-015: Runtime self-contained install
Requirement:
- A packed tarball must install with `npm install --omit=dev` in a clean directory.
- Runtime smoke must import and execute:
  - `parse`
  - `serialize`
  - `parseBytes`
  - `parseFragment`
  - `parseStream`
- Smoke output must include `runtime-self-contained ok`.

Evidence:
- `reports/runtime-self-contained.json` with `ok=true`

---

### G-020: ESM only
Requirement:
- `package.json` contains `"type": "module"`.
- `exports` MUST NOT contain `require` keys.

---

### G-030: Runtime code uses Web APIs only (no Node builtins)
Requirement:
- Files under `src/` MUST NOT import Node builtin modules
  (neither `node:*` nor bare builtin names like `fs`, `path`, `crypto`).
- `require(...)` must not appear in `src/`.

Evidence:
- `reports/no-node-builtins.json`

---

### G-040: Conformance — tokenizer fixtures
Requirement:
- Non-holdout tokenizer executed pass rate >= `thresholds.conformance.tokenizer.minPassRate`
- Skips <= `thresholds.conformance.tokenizer.maxSkips`
- Every skip MUST reference a decision record that exists.
- Holdout discipline is enforced:
  - `executedSurface = passed + failed`
  - `totalSurface = passed + failed + skipped + holdoutExcluded`
  - `holdoutExcludedFraction = holdoutExcluded / totalSurface`
  - `holdoutExcludedFraction` MUST be within `[0.05, 0.15]`
  - `holdoutRule` and `holdoutMod` MUST be present in the report artifact.

Evidence:
- `reports/tokenizer.json`

---

### G-050: Conformance — tree-construction fixtures
Requirement:
- Same requirements as G-040, including holdout discipline checks.

Evidence:
- `reports/tree.json`

---

### G-060: Conformance — encoding fixtures
Requirement:
- Same requirements as G-040, including holdout discipline checks.

Evidence:
- `reports/encoding.json`

---

### G-070: Conformance — serializer fixtures
Requirement:
- Same requirements as G-040, including holdout discipline checks.

Evidence:
- `reports/serializer.json`

---

### G-080: Determinism
Requirement:
- Determinism checks pass within runtime and across runtimes.
- `reports/determinism.json.runtimes.node.hash` must exist.
- `reports/determinism.json.runtimes.deno.hash` must exist.
- `reports/determinism.json.runtimes.bun.hash` must exist.
- `reports/determinism.json.crossRuntime.ok` must be `true`.
- `reports/determinism.json.overall.ok` must be `true`.

Evidence:
- `reports/determinism.json`

---

### G-085: Streaming invariants
Requirement:
- `reports/stream.json` must exist for CI and release profiles.
- Stream budget checks must pass, including `maxBufferedBytes` enforcement.
- Stream parsing over chunked transport must match `parseBytes` for equivalent byte input.

Evidence:
- `reports/stream.json`

---

### G-086: Agent feature report
Requirement:
- `reports/agent.json` must exist for CI and release profiles.
- `reports/agent.json.overall.ok` must be `true`.
- Feature checks must validate deterministic behavior and boundedness for:
  - `trace`
  - `spans`
  - `patch`
  - `outline`
  - `chunk`
  - `streamToken`
  - `visibleText`
  - `parseErrorId`

Evidence:
- `reports/agent.json`

---

### G-087: Visible text contract
Requirement:
- `visibleText` and `visibleTextTokens` exports are present in the public API.
- `docs/visible-text.md` exists.
- `test/control/visible-text.test.js` exists.
- `test/fixtures/visible-text/v1/` has at least 30 fixture cases.
- Each fixture case contains:
  - `input.html`
  - `expected.txt`
  - `expected.tokens.json`
- Agent report includes `features.visibleText.ok=true`.

Evidence:
- `reports/gates.json` gate `G-087`

---

### G-088: Parse error taxonomy contract
Requirement:
- `getParseErrorSpecRef` export is present in the public API.
- Parser-reported errors expose `parseErrorId` with deterministic values for identical input.
- `getParseErrorSpecRef(parseErrorId)` returns the stable WHATWG parse-errors section URL.
- `docs/parse-errors.md` exists.
- `test/control/parse-errors.test.js` exists.
- Agent report includes `features.parseErrorId.ok=true`.

Evidence:
- `reports/gates.json` gate `G-088`

---

### G-089: Span provenance and patch safety
Requirement:
- Parsed nodes expose `spanProvenance` with values:
  - `input`
  - `inferred`
  - `none`
- Patch planning rejects non-input spans with structured `PatchPlanningError`:
  - `code: NON_INPUT_SPAN_PROVENANCE`
- `docs/spec.md` documents `spanProvenance`.
- `test/control/spans-patch.test.js` validates provenance and patch rejection behavior.
- Agent report includes:
  - `features.spans.ok=true`
  - `features.patch.ok=true`

Evidence:
- `reports/gates.json` gate `G-089`

---

### G-090: Resource governance (budgets) works
Requirement:
- Budget exceed produces a structured error (not crash, not hang).
- No hangs in budget tests or fuzz.

Evidence:
- `reports/budgets.json` and/or `reports/fuzz.json`

---

### G-100: Cross-runtime smoke tests
Requirement:
- Smoke tests pass on:
  - Node (mandatory)
  - Deno and Bun (mandatory in CI and release profiles)
- `reports/smoke.json` is derived from executed runtime smoke reports:
  - `reports/smoke-node.json`
  - `reports/smoke-deno.json`
  - `reports/smoke-bun.json`
- `reports/smoke.json.overall.ok` is `true`.

Evidence:
- `reports/smoke.json`

---

### G-110: Packaging sanity
Requirement:
- `npm pack` tarball MUST NOT include forbidden paths.
- `npm pack` tarball MUST include `THIRD_PARTY_NOTICES.md`.
- `exports` resolution sanity checks pass.

Evidence:
- `reports/pack.json`

---

### G-120: Documentation + dataset hygiene
Requirement:
- Required files exist:
  - README.md
  - SECURITY.md
  - LICENSE
  - docs/third-party.md
  - docs/update-playbook.md
  - docs/naming-conventions.md
  - docs/decisions/README.md

Evidence:
- `reports/docs.json`

---

### G-125: Text hygiene (no hidden control characters)
Requirement:
- Review-evasion characters are forbidden in tracked first-party text files.
- Scanned tracked files must not contain:
  - Unicode hidden format characters:
    - U+00AD
    - U+034F
    - U+180E
    - U+200B
    - U+200C
    - U+200D
    - U+2060
    - U+FEFF
  - Unicode bidirectional control characters:
    - U+061C
    - U+200E
    - U+200F
    - U+202A through U+202E
    - U+2066 through U+2069
  - U+0000 (NUL)
- Scan coverage:
  - `docs/`
  - `src/`
  - `scripts/`
  - `test/`
  - `tests/`
  - `.github/`
  - root tracked human-authored text and configuration files
    - includes: `README.md`, `package.json`, `jsr.json`, `tsconfig*.json`, `eslint.config.mjs`, and similar root configs
- Exclusions:
  - `vendor/`
  - `node_modules/`
  - `tmp/`
  - `dist/`
  - `reports/`

Evidence:
- `reports/text-hygiene.json` with `ok=true`

---

### G-126: Doc policy coherence
Requirement:
- Naming and log label policy must have one canonical statement in `docs/naming-conventions.md`.
- `CONTRIBUTING.md` must reference the canonical statement and must not define a contradictory log label rule.
- The canonical marker and policy reference marker must match exactly.

Evidence:
- `reports/doc-policy.json` with `ok=true`

---

### G-127: Doc TypeScript snippets compile
Requirement:
- TypeScript snippets from `README.md` and `docs/*.md` must compile in `noEmit` mode.
- Snippets must use the canonical package import specifier:
  - `@ismail-elkorchi/html-parser`
- Snippet evaluation must compile only; it must not execute snippet code.

Evidence:
- `reports/doc-snippets.json` with `ok=true`

---

### G-128: Score model coherence
Requirement:
- For each evaluation profile, score category weights must align with required report policy:
  - `correctness` weight > 0 requires `requireConformanceReports=true`
  - `agentFirst` weight > 0 requires `requireAgentReport=true`
  - `packagingTrust` weight > 0 requires `requirePackReport=true` and `requireDocsReport=true`
  - `robustness` weight > 0 requires `requireBudgetsReport=true`
    - fuzz contribution policy must match scoring policy (`robustnessUsesFuzz === requireFuzzReport`)
  - `performance` weight > 0 requires `requireBenchReport=true`
  - `browserDiff` weight > 0 requires `requireBrowserDiff=true`

Evidence:
- `reports/gates.json` gate `G-128` with `pass=true`

---

## Gate set: RELEASE profile (must pass)

Release includes ALL CI gates plus:

### R-200: Holdout suite executed and passes
Requirement:
- Holdout execution covers all conformance suites:
  - tokenizer
  - tree
  - encoding
  - serializer
- Holdout pass rate must meet strict threshold (`1.0`).
- Holdout skips must be `0`.

Evidence:
- `reports/holdout.json`

---

### R-210: Browser differential oracle (required)
Requirement:
- Browser differential agreement must meet strict threshold (`>= 0.999`).
- Must include Chromium, Firefox, and WebKit (`minEnginesPresent = 3`).
- Corpus execution surface must meet `thresholds.browserDiff.minCases` (`>= 500`).
- Coverage discipline must meet `thresholds.browserDiff.minTagCoverage` (`>= 10`) for each required browser corpus tag.

Evidence:
- `reports/browser-diff.json`

---

### R-220: Fuzz report required (release)
Requirement:
- `reports/fuzz.json` must exist in release evaluation.
- `crashes` must be `0`.
- `hangs` must be `0`.

Evidence:
- `reports/fuzz.json`

---

## Changing gates is allowed only with a decision record

Any change to:
- thresholds in `evaluation.config.json`
- required reports for a profile
- skip policy for fixtures

MUST be documented via an ADR.
