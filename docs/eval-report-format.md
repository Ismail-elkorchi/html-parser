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

## Stream invariants report
File:
- reports/stream.json

Shape:
{
  "suite": "stream",
  "timestamp": "...",
  "overall": { "ok": true },
  "checks": [
    {
      "id": "stream-many-chunks-equals-parse-bytes",
      "ok": true,
      "observed": { "hash": "sha256:..." },
      "expected": { "hash": "sha256:..." }
    },
    {
      "id": "stream-max-buffered-bytes-fails-before-overrun",
      "ok": true,
      "observed": { "budget": "maxBufferedBytes", "actual": 17 },
      "expected": { "budget": "maxBufferedBytes", "actual": 17 }
    }
  ]
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
  "corpus": {
    "name": "curated-v3",
    "totalCases": 560,
    "curatedCases": 560,
    "randomCases": 64,
    "seed": "0x5f3759df"
  },
  "coverage": {
    "tagCounts": {
      "tokenizer/entities": 70,
      "adoption-agency": 70,
      "tables/foster-parenting": 70,
      "foreign-content (svg/mathml)": 70,
      "templates": 70,
      "optional-tags": 70,
      "comments/doctype": 70,
      "scripting-flag surface (document.write-like markup patterns as strings only)": 70
    },
    "minPerTag": 10
  },
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
- Disagreement entries use deterministic case IDs from curated and random corpus sets.
- The browser-diff command may fail only when configured browser thresholds are not met (engine presence, agreement, corpus size, tag coverage).

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
  "outcomeDistribution": {
    "normalParses": 880,
    "budgetErrors": 120,
    "crashes": 0
  },
  "topSlowCases": [
    {
      "id": "fuzz-0007",
      "seed": "0x1234abcd",
      "budgetProfile": "tight",
      "elapsedMs": 8.731,
      "outcome": "budget-error"
    }
  ],
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
    "trace": { "ok": true, "details": {} },
    "spans": { "ok": true, "details": {} },
    "patch": { "ok": true, "details": {} },
    "outline": { "ok": true, "details": {} },
    "chunk": { "ok": true, "details": {} },
    "streamToken": { "ok": true, "details": {} }
  },
  "overall": {
    "ok": true
  }
}

Rules:
- `features.trace.ok` must reflect structured trace schema validation (not only non-empty trace arrays).
- `overall.ok` must be `true` for gate `G-086`.

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

Rules:
- `missingFiles` is validated against the docs gate required list in `scripts/eval/check-docs.mjs`.
- The required list includes `docs/naming-conventions.md`.

## Text hygiene report
File:
- reports/text-hygiene.json

Shape:
{
  "suite": "text-hygiene",
  "timestamp": "...",
  "ok": true,
  "scannedFileCount": 0,
  "violations": [
    {
      "path": "docs/example.md",
      "codePointHex": "U+202E",
      "index": 12
    }
  ]
}

Rules:
- The report fails (`ok=false`) if any scanned file includes banned Unicode bidi controls or U+0000.
- The scan surface and exclusions are defined by gate `G-125` in `docs/acceptance-gates.md`.

## Doc policy report
File:
- reports/doc-policy.json

Shape:
{
  "suite": "doc-policy",
  "timestamp": "...",
  "ok": true,
  "canonicalPath": "docs/naming-conventions.md",
  "referencePath": "CONTRIBUTING.md",
  "checks": [
    {
      "id": "canonical-marker-singleton",
      "ok": true
    }
  ],
  "failures": []
}

Rules:
- The canonical log label policy marker is defined in `docs/naming-conventions.md`.
- `CONTRIBUTING.md` references the same marker and canonical path.
- Contradictory tag-prefix policy text in `CONTRIBUTING.md` causes `ok=false`.
