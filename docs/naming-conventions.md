# Naming conventions

## Purpose
Names in this repository are part of the verification surface. A name must encode intent, scope, and guarantees with minimal ambiguity.

## Core rules
- Use activation handles:
  - Prefer common English lemmas that map to parser, evaluation, and security domains.
  - Avoid neologisms and overloaded abbreviations.
- Use ontology-first casing:
  - `PascalCase` for enduring kinds (`TraceEvent`, `BudgetExceededError`).
  - `camelCase` for instances and roles (`runtimeSelfContainedReport`, `tagCoverageCounts`).
  - Verb-first functions for effects (`runConformanceSuite`, `checkRuntimeSelfContained`).
- Use cue-to-action-to-evaluation naming:
  - `cue*` for selectors/keys.
  - `act*` for transforms/execution.
  - `eval*` for checks/assertions.
  - Keep one function per stage to avoid mixed semantics.
- Use topic-to-focus ordering:
  - Lead with domain anchor, then predicate, then qualifier.
  - Example: `browserDiff.minTagCoverage`, `runtimeSelfContained.ok`.
- Use explicit frames of reference:
  - Prefer `source/target`, `input/output`, `local/remote`, `user/agent/system`.
  - Avoid deictic terms such as `this`, `that`, `here`.
- Use truth-conditional booleans:
  - `isReady`, `hasContext`, `canRetry`.
  - Prefer affirmative polarity; avoid double negation.
- Encode modality and lifecycle status:
  - Suffixes: `Draft`, `Proposed`, `Final`, `Pending`, `Loaded`, `Expired`, `Retryable`, `Idempotent`.
- Do not promise guarantees that code does not enforce:
  - Reserve terms such as `Safe`, `Valid`, `Canonical` for verified paths only.
  - Use `Candidate`, `Maybe`, `Hypothesis` for uncertain states.
- Keep compositional meaning:
  - Each term adds one constraint.
  - Do not mix abstraction levels in a single identifier.
- Prefer roles over containers:
  - `authContext`, `renderSink`, `retrievalIndex`.
  - Avoid `configObj`, `dataList`, `helper`.

## Prompt and log labels
- Prompt labels use plain anchors:
  - `Instruction:`, `Context:`, `Constraints:`, `Output:`.
- Log messages use stable domain phrasing:
  - avoid synthetic uppercase tag prefixes.

## Greppability and taxonomy
- Use ASCII-only identifiers and stable stems.
- Prefer stable prefixes by domain:
  - `eval*`, `gate*`, `trace*`, `budget*`, `tokenizer*`, `tree*`, `encoding*`, `serializer*`.
- Align identifiers with taxonomy paths when applicable:
  - Example: `ideas.ethics.kant` style path mapping for report categories.

## Function speech-acts
- Performatives for effects: `create`, `update`, `delete`, `run`, `emit`.
- Constatives for queries: `get`, `find`, `list`, `check`, `estimate`.
- Do not use query verbs for mutating functions.

## Null-head ban
- Avoid heads like `Manager`, `Service`, `Helper`.
- If a coordinating type is required, make the head domain-specific (`PlanCompiler`, `GateEvaluator`).

## Length rule
- Keep names short only when signal is preserved.
- Remove filler words, keep the domain anchor.
