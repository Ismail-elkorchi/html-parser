import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  BudgetExceededError,
  chunk,
  outline,
  parse,
  parseBytes,
  parseFragment,
  parseStream,
  serialize,
  tokenizeStream
} from "../../dist/mod.js";

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseArgs(argv) {
  const parsed = {
    runtime: null,
    reportPath: null
  };

  for (const argumentValue of argv) {
    if (argumentValue.startsWith("--runtime=")) {
      parsed.runtime = argumentValue.slice("--runtime=".length);
      continue;
    }
    if (argumentValue.startsWith("--report=")) {
      parsed.reportPath = argumentValue.slice("--report=".length);
    }
  }

  return parsed;
}

function detectRuntime() {
  if (typeof globalThis.Deno?.version?.deno === "string") {
    return "deno";
  }
  if (typeof globalThis.Bun?.version === "string") {
    return "bun";
  }
  return "node";
}

function resolveRuntime(runtimeArg) {
  if (runtimeArg === null) {
    return detectRuntime();
  }
  if (runtimeArg === "node" || runtimeArg === "deno" || runtimeArg === "bun") {
    return runtimeArg;
  }
  throw new Error(`Unsupported runtime: ${runtimeArg}`);
}

function runtimeVersion(runtime) {
  if (runtime === "node") {
    return process.version;
  }
  if (runtime === "deno") {
    return String(globalThis.Deno?.version?.deno || "unknown");
  }
  return String(globalThis.Bun?.version || "unknown");
}

async function writeReport(reportPath, payload) {
  const absoluteReportPath = resolve(reportPath);
  await mkdir(dirname(absoluteReportPath), { recursive: true });
  await writeFile(absoluteReportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createByteStream(byteChunks) {
  const Stream = globalThis.ReadableStream;
  if (typeof Stream !== "function") {
    throw new Error("ReadableStream is unavailable in this runtime");
  }

  return new Stream({
    start(controller) {
      for (const value of byteChunks) {
        controller.enqueue(value);
      }
      controller.close();
    }
  });
}

async function runSmokeAssertions() {
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
    createByteStream([sampleBytes.subarray(0, 9), sampleBytes.subarray(9, 21), sampleBytes.subarray(21)])
  );
  const bytesResult = parseBytes(sampleBytes);
  ensure(
    JSON.stringify(streamResult) === JSON.stringify(bytesResult),
    "parseStream output mismatch vs parseBytes"
  );

  const tokenKinds = [];
  for await (const token of tokenizeStream(createByteStream([new TextEncoder().encode("<p>smoke</p>")]))) {
    tokenKinds.push(token.kind);
  }
  ensure(
    JSON.stringify(tokenKinds) === JSON.stringify(["startTag", "chars", "endTag", "eof"]),
    "tokenizeStream mismatch"
  );

  const outlineResult = outline(parsed);
  ensure(outlineResult.entries.length === 0, "outline generation mismatch");

  const chunkPlan = chunk(parsed);
  ensure(chunkPlan.length === 1, "chunk generation mismatch");
  ensure(chunkPlan[0]?.nodes === 5, "chunk node count mismatch");

  let budgetError = null;
  try {
    parse("budget", { budgets: { maxInputBytes: 3 } });
  } catch (error) {
    budgetError = error;
  }

  ensure(budgetError instanceof BudgetExceededError, "expected BudgetExceededError");
  ensure(budgetError.payload.code === "BUDGET_EXCEEDED", "expected structured budget code");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runtime = resolveRuntime(args.runtime);
  const timestamp = new Date().toISOString();

  let failure = null;
  try {
    await runSmokeAssertions();
  } catch (error) {
    failure = error;
  }

  if (args.reportPath) {
    await writeReport(args.reportPath, {
      suite: "smoke-runtime",
      runtime,
      timestamp,
      ok: failure === null,
      version: runtimeVersion(runtime),
      determinismHash: null,
      ...(failure
        ? { failure: failure instanceof Error ? failure.message : String(failure) }
        : {})
    });
  }

  if (failure) {
    throw failure;
  }

  console.log("control smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
