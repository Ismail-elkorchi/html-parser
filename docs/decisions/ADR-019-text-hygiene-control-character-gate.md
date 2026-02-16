# ADR-019: Text hygiene gate for hidden Unicode control characters

Status: Accepted  
Date: 2026-02-16

## Context

Security-sensitive repositories can hide behavior in source text using bidirectional Unicode control characters.
These characters can alter visual ordering in editors and code review views without changing raw bytes.
The repository also requires generated output directories and vendored corpora to remain outside policy scans.

## Decision

- Add a required evaluation gate `G-125` for text hygiene.
- Implement `scripts/eval/check-text-hygiene.mjs` and run it in both `ci` and `release` evaluation profiles.
- Ban the following review-evasion code points in scanned tracked files:
  - U+00AD
  - U+034F
  - U+180E
  - U+200B
  - U+200C
  - U+200D
  - U+2060
  - U+FEFF
  - U+061C
  - U+200E
  - U+200F
  - U+202A through U+202E
  - U+2066 through U+2069
  - U+0000 (NUL)
- Scan first-party tracked text coverage:
  - `docs/`
  - `src/`
  - `scripts/`
  - `test/`
  - `tests/`
  - `.github/`
  - root tracked human-authored text/config files (`README.md`, `package.json`, `jsr.json`, `tsconfig*.json`, `eslint.config.mjs`, and similar root configs)
- Exclude machine/vendor paths:
  - `vendor/`
  - `node_modules/`
  - `tmp/`
  - `dist/`
  - `reports/`

## Alternatives considered

- Rely on code review to detect hidden characters.
  - Rejected: review tools and fonts can hide or normalize control characters.
- Scan all tracked paths including vendored corpora.
  - Rejected: vendored corpora are external artifacts and create noise unrelated to first-party policy.

## Consequences

- CI and release fail when banned hidden/review-evasion code points are introduced in first-party tracked text.
- The gate output (`reports/text-hygiene.json`) provides deterministic evidence with path, code point, and index.
- Vendored and generated artifact content remains outside this gate by policy.

## Validation plan

- `npm run eval:ci`
- Add a temporary test file under `docs/` containing a banned code point and confirm `eval:ci` fails with a report entry.
- Remove the temporary file and re-run `eval:ci` to confirm pass.

## Rollback plan

- If false positives block development, add a superseding ADR with a narrower scan surface.
- Keep the gate in place unless an approved replacement provides equivalent protection.
