import {
  computePatch,
  parse,
  parseBytes,
  serialize,
  visibleText
} from "../dist/mod.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runParseScenario() {
  const tree = parse("<article><h1>Title</h1><p>Hello</p></article>");
  assert(tree.kind === "document", "parse should return a document tree");
  assert(tree.children.length > 0, "document tree should contain children");

  const text = visibleText(tree).trim();
  assert(text.includes("Title"), "visibleText should include heading text");

  const html = serialize(tree);
  assert(html.includes("<article>"), "serialize should keep article element");
}

function runParseBytesScenario() {
  const bytes = new TextEncoder().encode("<p>bytes-input</p>");
  const tree = parseBytes(bytes, {
    budgets: {
      maxInputBytes: 1024,
      maxNodes: 128
    }
  });
  const html = serialize(tree);
  assert(html.includes("bytes-input"), "parseBytes should decode and parse bytes");
}

function runPatchScenario() {
  const original = "<p class=\"state\">before</p>";
  const parsed = parse(original, { captureSpans: true });
  const findFirst = (nodes, predicate) => {
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
  };

  const paragraph = findFirst(parsed.children, (node) => node.kind === "element" && node.tagName === "p");
  assert(paragraph !== null, "patch scenario should find a paragraph node");
  const textNode = findFirst(paragraph.children, (node) => node.kind === "text");
  assert(textNode !== null, "patch scenario should find paragraph text");

  const plan = computePatch(original, [
    {
      kind: "setAttr",
      target: paragraph.id,
      name: "class",
      value: "updated"
    },
    {
      kind: "replaceText",
      target: textNode.id,
      value: "after"
    }
  ]);

  const patched = serialize(parse(plan.result));
  assert(patched.includes("after"), "patch plan should update text content");
}

runParseScenario();
runParseBytesScenario();
runPatchScenario();

console.log("examples:run ok");
