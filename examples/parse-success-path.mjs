/**
 * Demonstrates deterministic parsing, visible-text extraction, and serialization.
 * Run: npm run build && node examples/parse-success-path.mjs
 */
import { parse, serialize, visibleText } from "../dist/mod.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function runParseSuccessPath() {
  const html = [
    "<article>",
    "  <h1>Release Candidate</h1>",
    "  <p>Deterministic parse output.</p>",
    "</article>"
  ].join("\n");

  const tree = parse(html);
  assert(tree.kind === "document", "parse should return a document tree");

  const text = visibleText(tree).trim();
  assert(text.includes("Release Candidate"), "visible text should include the heading");
  assert(text.includes("Deterministic parse output."), "visible text should include the paragraph");

  const serialized = serialize(tree);
  assert(serialized.includes("<article>"), "serialize should preserve article markup");
  return { text, serialized };
}

if (import.meta.main) {
  const result = runParseSuccessPath();
  console.log("parse-success-path ok", result.text.length, result.serialized.length);
}
