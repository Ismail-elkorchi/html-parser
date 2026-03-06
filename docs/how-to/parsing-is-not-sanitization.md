# Parsing Is Not Sanitization

## Goal
Understand the security boundary: `html-parser` gives you deterministic
structure and text extraction, but it does not make hostile HTML safe to render.

## Prerequisites
- `@ismail-elkorchi/html-parser` installed
- A separate sanitization or rendering policy in the application boundary

## Copy/paste
```ts
import { parse, visibleText } from "@ismail-elkorchi/html-parser";

const unsafeHtml = `<img src="x" onerror="alert(1)"><p>Hello</p>`;
const tree = parse(unsafeHtml);

console.log(visibleText(tree, { trim: true }));
console.log(tree.children.length > 0);
```

## Expected output
```txt
Hello
true
```

## Common failure modes
- Unsafe pattern: parsing untrusted HTML and then injecting the original source
  into a browser or template sink because it "parsed successfully".
- Safe pattern: parsing to inspect structure or extract text, then applying a
  dedicated sanitizer or rejecting the input before any rendering step.
- Confusing visible-text extraction with policy enforcement; event handlers,
  URLs, and dangerous attributes are still present in the original markup.

## Related reference
- [Security posture](../explanation/security-posture.md)
- [Options](../reference/options.md)
- [Error model](../reference/error-model.md)
