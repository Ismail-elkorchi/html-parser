# ADR-003: Oracle choice / normalization rules <short description>

- Status: proposed | accepted | superseded
- Date: YYYY-MM-DD

## Context
- Which oracle is involved?
  - html5lib-tests
  - browser DOMParser differential
  - other dev-only oracle
- What normalization is required to make comparisons meaningful?

## Decision
- Define normalization rules precisely (tree serialization, attribute ordering, namespace handling).
- Define disagreement handling (how we produce triage records).

## Consequences
- What behaviors become in scope vs out of scope?

## Validation plan
- How will we detect oracle drift?

## Rollback plan
- If normalization hides bugs, how do we fix it?

## Links
- docs/eval-report-format.md
- divergence triage records
