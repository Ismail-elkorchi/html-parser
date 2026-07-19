# Apply Structural Patches

Goal: generate deterministic edit plans for known element ids.

```ts
import { applyPatchPlan, computePatch, parse, serialize } from "@ismail-elkorchi/html-parser";

const original = "<main><h1>Title</h1><p>Draft</p></main>";
const parsed = parse(original, {
  captureSpans: true,
  sourceRetention: "text"
});

const html = parsed.tree.children[0];
const body = html?.kind === "element" ? html.children[1] : undefined;
const main = body?.kind === "element" ? body.children[0] : undefined;
const heading = main?.kind === "element" ? main.children[0] : undefined;
const headingText = heading?.kind === "element" ? heading.children[0] : undefined;
if (!headingText || headingText.kind !== "text") {
  throw new Error("unexpected tree shape");
}

const plan = computePatch(parsed, [
  { kind: "replaceText", target: headingText.id, value: "Published" }
]);
const patched = applyPatchPlan(parsed, plan);
console.log(serialize(parse(patched).tree));
```

Expected output:
- Patched markup with deterministic edit ordering.
