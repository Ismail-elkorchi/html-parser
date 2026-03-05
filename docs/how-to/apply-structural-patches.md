# Apply Structural Patches

Goal: generate deterministic edit plans for known element ids.

```ts
import { applyPatchPlan, computePatch, parse, serialize } from "@ismail-elkorchi/html-parser";

const original = "<main><h1>Title</h1><p>Draft</p></main>";
const parsed = parse(original);

const heading = parsed.children[0]?.kind === "element" ? parsed.children[0].children[0] : undefined;
if (!heading || heading.kind !== "element") {
  throw new Error("unexpected tree shape");
}

const plan = computePatch(original, [
  { kind: "replaceText", target: heading.id, value: "Published" }
]);
const patched = applyPatchPlan(original, plan);
console.log(serialize(parse(patched)));
```

Expected output:
- Patched markup with deterministic edit ordering.
