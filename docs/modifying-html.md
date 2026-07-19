# Modifying source HTML

The npm surface can compute deterministic source edits without serializing the
whole parsed tree. Parse once with spans and exact source retention, locate
targets structurally, compute a plan, then apply that plan to the same parsed
document.

```ts
import {
  applyPatchPlan,
  computePatch,
  findAllByTagName,
  parse
} from "@ismail-elkorchi/html-parser";

const original = "<main><h1>Draft</h1><p>Body</p></main>";
const document = parse(original, {
  captureSpans: true,
  sourceRetention: "text"
});

const [heading] = findAllByTagName(document.tree, "h1");
const headingText = heading?.children.find((node) => node.kind === "text");
if (headingText?.kind !== "text") {
  throw new Error("heading text not found");
}

const plan = computePatch(document, [
  { kind: "replaceText", target: headingText.id, value: "Published" }
]);
const updated = applyPatchPlan(document, plan);

console.log(updated); // <main><h1>Published</h1><p>Body</p></main>
```

Supported edits remove a node, replace a text node, set or remove an
attribute, and insert HTML immediately before or after a node. Plans reject
overlapping edits and targets without input-derived spans.

A plan is tied to the exact `ParsedDocument` that produced it. It cannot be
applied to a different parse, even when the source strings happen to match.
Parser-inferred nodes have no source slice and cannot be used where an edit
requires one.

Patch insertion strings are source text, not automatically parsed or
sanitized. Validate or sanitize them according to the eventual rendering
context.
