# ADR-008: Encoding and serializer conformance mismatches are hard failures

## Status
Accepted

## Context

Encoding and serializer conformance previously allowed mismatch skips, which reduced gate precision and hid drift in byte-decoding and serialization behavior.

## Decision

- Encoding and serializer mismatches are counted as `failed`, never `skipped`.
- `skipped` is reserved for deterministic holdout exclusion only.
- Conformance thresholds are strict:
  - `encoding.minPassRate = 1.0`, `encoding.maxSkips = 0`
  - `serializer.minPassRate = 1.0`, `serializer.maxSkips = 0`

## Consequences

- CI blocks on any encoding or serializer mismatch.
- Fixture options for serializer are now enforced as executable behavior (quoting policy, optional-tag omission, whitespace policy, and charset injection).
- The staged skip records for encoding/serializer are superseded for active conformance gates.
