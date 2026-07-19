/**
 * What it does: parses HTML, extracts visible text, then serializes the tree.
 * Expected output: prints "parse-success-path ok" and non-zero text/serialization lengths.
 * Constraints: expects parser outputs to remain deterministic for the same input string.
 * Run: npm run build && node examples/parse-success-path.mjs
 */
import { VISIBLE_TEXT_HTML_POLICY, extractText, parse, serialize } from "../dist/mod.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function runParseSuccessPath() {
  const html = [
    "<article>",
    "  <h1>Example Article</h1>",
    "  <p>Deterministic parse output.</p>",
    "</article>"
  ].join("\n");

  const { tree } = parse(html);
  assert(tree.kind === "document", "parse should return a document tree");

  const text = extractText(tree, {
    policy: VISIBLE_TEXT_HTML_POLICY,
    maxOutputBytes: 16_384,
    maxTokens: 1_024,
    maxFallbackInputBytes: 16_384,
    maxFallbackNodes: 1_024
  }).text;
  assert(text.includes("Example Article"), "visible text should include the heading");
  assert(text.includes("Deterministic parse output."), "visible text should include the paragraph");

  const serialized = serialize(tree);
  assert(serialized.includes("<article>"), "serialize should preserve article markup");
  return { text, serialized };
}

if (import.meta.main) {
  const result = runParseSuccessPath();
  console.log("parse-success-path ok", result.text.length, result.serialized.length);
}
