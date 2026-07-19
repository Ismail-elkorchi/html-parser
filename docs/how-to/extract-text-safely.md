# Extract Text Safely

## Goal
Get stable visible text from untrusted HTML while bounding parse, fallback,
token, and retained-output work and keeping sanitization as a separate step.

## Prerequisites
- `@ismail-elkorchi/html-parser` installed
- Untrusted or user-supplied HTML input

## Copy/paste
```ts
import {
  VISIBLE_TEXT_HTML_POLICY,
  extractText,
  isHtmlBudgetExceededError,
  parse
} from "@ismail-elkorchi/html-parser";

const input = `
  <article>
    <h1>Release</h1>
    <p>Hello <strong>world</strong>.</p>
    <script>console.log("not visible text")</script>
  </article>
`;

try {
  const { tree } = parse(input, {
    budgets: {
      maxInputBytes: 8_192,
      maxNodes: 512,
      maxDepth: 64
    }
  });

  const result = extractText(tree, {
    policy: VISIBLE_TEXT_HTML_POLICY,
    maxOutputBytes: 4_096,
    maxTokens: 256,
    maxFallbackInputBytes: 8_192,
    maxFallbackNodes: 512
  });
  console.log(result.text, result.truncated);
} catch (error) {
  if (isHtmlBudgetExceededError(error)) {
    console.log(error.code, error.budget);
  } else {
    throw error;
  }
}
```

## Expected output
```txt
Release Hello world. false
```

## Common failure modes
- `HtmlBudgetExceededError` when the input exceeds `maxInputBytes`, `maxNodes`, or
  `maxDepth`.
- Hidden or scripted content expectations are wrong because
  `VISIBLE_TEXT_HTML_POLICY` defines deterministic extraction, not browser
  layout or script execution.
- `result.truncated` is `true` when `maxOutputBytes` or `maxTokens` omits policy
  output. `result.totalBytes` still reports the exact complete policy output in
  canonical UTF-8 bytes.
- A `noscript` fallback can fail with `maxFallbackInputBytes`,
  `maxFallbackNodes`, or the shared operation deadline. Set both fallback caps
  for every visible-text extraction.
- Unsafe downstream rendering because the caller treated extracted text as
  evidence that the source HTML is safe.

## Related reference
- [Options](../reference/options.md)
- [Data model](../reference/data-model.md)
- [Error model](../reference/error-model.md)
- [Why parsing is not sanitization](./parsing-is-not-sanitization.md)
