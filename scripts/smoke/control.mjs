import {
  BudgetExceededError,
  chunk,
  outline,
  parseBytes,
  parse,
  parseStream,
  parseFragment,
  serialize
} from "../../dist/mod.js";

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeStream(chunks) {
  const Stream = globalThis.ReadableStream;
  if (typeof Stream !== "function") {
    throw new Error("ReadableStream is unavailable in this runtime");
  }

  return new Stream({
    start(controller) {
      for (const value of chunks) {
        controller.enqueue(value);
      }
      controller.close();
    }
  });
}

const parsed = parse("<p>smoke</p>");
ensure(parsed.kind === "document", "parse root type mismatch");
ensure(
  serialize(parsed) === "<html><head></head><body><p>smoke</p></body></html>",
  "parse output mismatch"
);

const fromBytes = parseBytes(new Uint8Array([0x68, 0x74, 0x6d, 0x6c]));
ensure(
  serialize(fromBytes) === "<html><head></head><body>html</body></html>",
  "parseBytes decoding mismatch"
);

const serialized = serialize(parsed);
ensure(serialized === "<html><head></head><body><p>smoke</p></body></html>", "serialize mismatch");

const first = parse("deterministic");
const second = parse("deterministic");
ensure(JSON.stringify(first) === JSON.stringify(second), "deterministic output mismatch");

const fragment = parseFragment("child", "section");
ensure(fragment.contextTagName === "section", "fragment context mismatch");

const sampleBytes = new Uint8Array([
  0x3c, 0x6d, 0x65, 0x74, 0x61, 0x20, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x3d, 0x77, 0x69, 0x6e, 0x64,
  0x6f, 0x77, 0x73, 0x2d, 0x31, 0x32, 0x35, 0x32, 0x3e, 0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e
]);

const streamResult = await parseStream(
  makeStream([sampleBytes.subarray(0, 9), sampleBytes.subarray(9, 21), sampleBytes.subarray(21)])
);
const bytesResult = parseBytes(sampleBytes);
ensure(
  JSON.stringify(streamResult) === JSON.stringify(bytesResult),
  "parseStream output mismatch vs parseBytes"
);

const out = outline(parsed);
ensure(out.entries.length === 0, "outline generation mismatch");

const chunks = chunk(parsed);
ensure(chunks.length === 1, "chunk generation mismatch");
ensure(chunks[0]?.nodes === 5, "chunk node count mismatch");

let budgetError = null;
try {
  parse("budget", { budgets: { maxInputBytes: 3 } });
} catch (error) {
  budgetError = error;
}

ensure(budgetError instanceof BudgetExceededError, "expected BudgetExceededError");
ensure(budgetError.payload.code === "BUDGET_EXCEEDED", "expected structured budget code");

console.log("control smoke passed");
