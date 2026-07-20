/** Computes and applies a source-aware edit plan. Run after `npm run build`. */
import {
  applyPatchPlan,
  computePatch,
  findAllByTagName,
  parse,
  serialize
} from "../dist/mod.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function runPatchPlanUpdate() {
  const original = '<p class="state">before</p>';
  const parsed = parse(original, { captureSpans: true, sourceRetention: "text" });
  const [paragraph] = findAllByTagName(parsed.tree, "p");
  assert(paragraph, "expected a paragraph node");
  const textNode = paragraph.children.find((node) => node.kind === "text");
  assert(textNode, "expected a paragraph text node");

  const patch = computePatch(parsed, [
    { kind: "setAttr", target: paragraph.id, name: "class", value: "updated" },
    { kind: "replaceText", target: textNode.id, value: "after" }
  ]);

  const updated = applyPatchPlan(parsed, patch);
  assert(updated === patch.result, "applying a patch plan should reproduce its result");

  const replayed = serialize(parse(updated).tree);
  assert(replayed.includes('class="updated"'), "patch should update class attribute");
  assert(replayed.includes("after"), "patch should update text content");
  return replayed;
}

if (import.meta.main) {
  const replayed = runPatchPlanUpdate();
  console.log("patch-plan-update ok", replayed.length);
}
