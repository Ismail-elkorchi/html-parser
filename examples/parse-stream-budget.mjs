/**
 * Demonstrates stream parsing with explicit parse budgets.
 * Run: npm run build && node examples/parse-stream-budget.mjs
 */
import { parseStream, serialize } from "../dist/mod.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function runParseStreamBudget() {
  const stream = new globalThis.ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<section><p>"));
      controller.enqueue(new TextEncoder().encode("stream"));
      controller.enqueue(new TextEncoder().encode(" input</p></section>"));
      controller.close();
    }
  });

  const tree = await parseStream(stream, {
    budgets: {
      maxInputBytes: 1024,
      maxBufferedBytes: 256,
      maxNodes: 128
    }
  });

  const serialized = serialize(tree);
  assert(serialized.includes("stream input"), "stream parse should preserve text content");
  return serialized;
}

if (import.meta.main) {
  const serialized = await runParseStreamBudget();
  console.log("parse-stream-budget ok", serialized.length);
}
