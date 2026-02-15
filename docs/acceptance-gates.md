# Acceptance gates (definition of “best”)

This document is the single operational definition of “best HTML parser in TypeScript”.
A parser qualifies as “best” only if it passes ALL gates in the chosen profile
and then achieves the highest composite score under `evaluation.config.json`.

Profiles:
- `ci`: day-to-day enforcement (no holdouts, browser diff optional)
- `release`: release enforcement (holdouts required, browser diff required)

Artifacts pinned by:
- `docs/spec-snapshots.md`
- `evaluation.config.json`

---

## Gate set: CI profile (must pass)

### G-000: Evaluation configuration exists
Requirement:
- `evaluation.config.json` exists and is valid JSON.

---

### G-010: Zero runtime dependencies
Requirement:
- `package.json` MUST NOT contain runtime dependencies.
- Acceptable:
  - `"dependencies": {}` or omitted
- Not acceptable:
  - any non-empty `"dependencies"`

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

Evidence:
- `reports/tokenizer.json`

---

### G-050: Conformance — tree-construction fixtures
Evidence:
- `reports/tree.json`

---

### G-060: Conformance — encoding fixtures
Evidence:
- `reports/encoding.json`

---

### G-070: Conformance — serializer fixtures
Evidence:
- `reports/serializer.json`

---

### G-080: Determinism
Requirement:
- Determinism checks pass in Node (mandatory).

Evidence:
- `reports/determinism.json`

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
  - Deno and Bun (mandatory in release profile)

Evidence:
- `reports/smoke.json`

---

### G-110: Packaging sanity
Requirement:
- `npm pack` tarball MUST NOT include forbidden paths.
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
  - docs/decisions/README.md

Evidence:
- `reports/docs.json`

---

## Gate set: RELEASE profile (must pass)

Release includes ALL CI gates plus:

### R-200: Holdout suite executed and passes
Evidence:
- `reports/holdout.json`

---

### R-210: Browser differential oracle (required)
Requirement:
- Browser differential agreement meets `thresholds.browserDiff.minAgreement`
- Must include at least `thresholds.browserDiff.minEnginesPresent` engines.

Evidence:
- `reports/browser-diff.json`

---

## Changing gates is allowed only with a decision record

Any change to:
- thresholds in `evaluation.config.json`
- required reports for a profile
- skip policy for fixtures

MUST be documented via an ADR.
