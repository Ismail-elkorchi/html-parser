# Evaluation report formats

All evaluation outputs MUST be written under `reports/` as JSON.
These reports are read by:
- `scripts/eval/check-gates.mjs`
- `scripts/eval/score.mjs`

Common fields:
- `suite`: string (e.g., "tokenizer")
- `timestamp`: ISO string
- `artifact`: object describing pinned inputs (fixture commit, dataset hash, etc)
- `cases`: { passed, failed, skipped, total }
- `failures`: array of objects (optional)
- `skips`: array of objects (optional, but required if skipped > 0)

## Conformance suite reports
Files:
- reports/tokenizer.json
- reports/tree.json
- reports/encoding.json
- reports/serializer.json
- reports/holdout.json

Shape (tokenizer/tree/encoding/serializer):
{
  "suite": "tokenizer",
  "timestamp": "...",
  "artifact": {
    "html5libTestsCommit": "...",
    "entitiesHash": "sha256:..."
  },
  "cases": { "passed": 0, "failed": 0, "skipped": 0, "total": 0 },
  "holdoutExcluded": 0,
  "holdoutRule": "hash(id) % 10 === 0",
  "holdoutMod": 10,
  "failures": [
    {
      "id": "path/to/file#caseId",
      "message": "brief",
      "repro": { "input": "...", "options": { } },
      "triageRecord": "docs/triage/....md"
    }
  ],
  "skips": [
    {
      "id": "path/to/file#caseId",
      "reason": "why skipped",
      "decisionRecord": "docs/decisions/ADR-0NN-....md"
    }
  ]
}

Shape (holdout aggregate):
{
  "suite": "holdout",
  "timestamp": "...",
  "holdoutRule": "hash(id) % 10 === 0",
  "holdoutMod": 10,
  "suites": {
    "tokenizer": {
      "cases": { "passed": 0, "failed": 0, "skipped": 0, "total": 0 },
      "holdoutRule": "hash(id) % 10 === 0",
      "holdoutMod": 10,
      "totalSurface": 0
    },
    "tree": {
      "cases": { "passed": 0, "failed": 0, "skipped": 0, "total": 0 },
      "holdoutRule": "hash(id) % 10 === 0",
      "holdoutMod": 10,
      "totalSurface": 0
    },
    "encoding": {
      "cases": { "passed": 0, "failed": 0, "skipped": 0, "total": 0 },
      "holdoutRule": "hash(id) % 10 === 0",
      "holdoutMod": 10,
      "totalSurface": 0
    },
    "serializer": {
      "cases": { "passed": 0, "failed": 0, "skipped": 0, "total": 0 },
      "holdoutRule": "hash(id) % 10 === 0",
      "holdoutMod": 10,
      "totalSurface": 0
    }
  },
  "cases": { "passed": 0, "failed": 0, "skipped": 0, "total": 0 },
  "failures": []
}

Rules:
- total = passed + failed + skipped
- If skipped > 0, each skip MUST include an existing decisionRecord path.
- `reports/holdout.json` MUST include per-suite breakdown for tokenizer/tree/encoding/serializer.

## Determinism report
File:
- reports/determinism.json

Shape:
{
  "suite": "determinism",
  "timestamp": "...",
  "cases": [
    {
      "id": "det-001",
      "ok": true,
      "hashes": {
        "node": "sha256:....",
        "deno": "sha256:....",
        "bun": "sha256:....",
        "browser": "sha256:...."
      }
    }
  ],
  "overall": { "ok": true }
}

## Budgets report
File:
- reports/budgets.json

Shape:
{
  "suite": "budgets",
  "timestamp": "...",
  "overall": { "ok": true },
  "checks": [
    {
      "id": "budget-maxNodes",
      "ok": true,
      "expectedErrorCode": "BUDGET_MAX_NODES",
      "observedErrorCode": "BUDGET_MAX_NODES"
    }
  ]
}

## Smoke report
File:
- reports/smoke.json

Shape:
{
  "suite": "smoke",
  "timestamp": "...",
  "runtimes": {
    "node": { "ok": true, "version": "v24.x" },
    "deno": { "ok": true, "version": "2.x" },
    "bun":  { "ok": true, "version": "1.x" },
    "browser": { "ok": true, "engine": "chromium" }
  }
}

## Browser differential report
File:
- reports/browser-diff.json

Shape:
{
  "suite": "browser-diff",
  "timestamp": "...",
  "corpus": { "name": "curated-v2", "seed": "0x5f3759df", "cases": 102 },
  "engines": {
    "chromium": {
      "compared": 0,
      "agreed": 0,
      "disagreed": 0,
      "version": "138.0.0.0",
      "userAgent": "Mozilla/5.0 ..."
    },
    "firefox":  {
      "compared": 0,
      "agreed": 0,
      "disagreed": 0,
      "version": "141.0",
      "userAgent": "Mozilla/5.0 ..."
    },
    "webkit":   {
      "compared": 0,
      "agreed": 0,
      "disagreed": 0,
      "version": "26.0",
      "userAgent": "Mozilla/5.0 ..."
    }
  },
  "disagreements": [
    {
      "id": "case-0001",
      "engine": "chromium",
      "triageRecord": "docs/triage/....md"
    }
  ]
}

Rules:
- Browser differential executes real engines (`chromium`, `firefox`, `webkit`) through Playwright.
- Release evidence requires multi-engine execution; chromium-only fallback is not valid release evidence.
- If an engine cannot launch, that engine entry may include `error`, and release gate must fail when required engine presence is not met.

## Fuzz report (recommended)
File:
- reports/fuzz.json

Shape:
{
  "suite": "fuzz",
  "timestamp": "...",
  "runs": 1000,
  "crashes": 0,
  "hangs": 0,
  "budgetErrors": 120,
  "findings": []
}

## Agent feature report
File:
- reports/agent.json

Shape:
{
  "suite": "agent",
  "timestamp": "...",
  "features": {
    "trace": { "ok": true, "bounded": true, "tested": true },
    "spans": { "ok": true, "tested": true },
    "outline": { "ok": true, "tested": true },
    "chunk": { "ok": true, "tested": true }
  }
}

Rules:
- `features.trace.ok` must reflect structured trace schema validation (not only non-empty trace arrays).

## Packaging report
File:
- reports/pack.json

Shape:
{
  "suite": "pack",
  "timestamp": "...",
  "ok": true,
  "tarball": "html-parser-1.0.0.tgz",
  "forbiddenIncluded": [],
  "dependenciesEmpty": true,
  "esmOnly": true,
  "exportsOk": true,
  "thirdPartyNoticesIncluded": true
}

## Docs report
File:
- reports/docs.json

Shape:
{
  "suite": "docs",
  "timestamp": "...",
  "ok": true,
  "missingFiles": [],
  "missingReadmeSections": []
}
