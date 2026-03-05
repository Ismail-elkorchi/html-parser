/**
 * What it does: computes an edit patch plan and reapplies it to HTML source.
 * Expected output: prints "patch-plan-update ok" with updated class/text assertions passing.
 * Constraints: requires span-aware parsing and deterministic node targeting by id.
 * Run: npm run build && node examples/patch-plan-update.mjs
 */
import { computePatch, parse, serialize } from "../dist/mod.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function findFirst(nodes, predicate) {
  for (const node of nodes) {
    if (predicate(node)) {
      return node;
    }
    if (node.kind === "element") {
      const nested = findFirst(node.children, predicate);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

export function runPatchPlanUpdate() {
  const original = '<p class="state">before</p>';
  const parsed = parse(original, { captureSpans: true });
  const paragraph = findFirst(parsed.children, (node) => node.kind === "element" && node.tagName === "p");
  assert(paragraph, "expected a paragraph node");
  const textNode = findFirst(paragraph.children, (node) => node.kind === "text");
  assert(textNode, "expected a paragraph text node");

  const patch = computePatch(original, [
    { kind: "setAttr", target: paragraph.id, name: "class", value: "updated" },
    { kind: "replaceText", target: textNode.id, value: "after" }
  ]);

  const replayed = serialize(parse(patch.result));
  assert(replayed.includes('class="updated"'), "patch should update class attribute");
  assert(replayed.includes("after"), "patch should update text content");
  return replayed;
}

if (import.meta.main) {
  const replayed = runPatchPlanUpdate();
  console.log("patch-plan-update ok", replayed.length);
}
