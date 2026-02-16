import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

import {
  BudgetExceededError,
  chunk,
  outline,
  parse,
  parseBytes,
  parseFragment,
  parseStream
} from "../../dist/mod.js";
import { writeJson } from "./util.mjs";

const execFileAsync = promisify(execFile);

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function asciiBytes(value) {
  return Array.from(value, (char) => char.charCodeAt(0));
}

function makeStream(chunks) {
  const streamFactory = globalThis.ReadableStream;
  if (typeof streamFactory !== "function") {
    throw new Error("ReadableStream is not available in this runtime");
  }

  return new streamFactory({
    start(controller) {
      for (const chunkValue of chunks) {
        controller.enqueue(chunkValue);
      }
      controller.close();
    }
  });
}

function headingTree() {
  const tree = {
    id: 100,
    kind: "document",
    children: [
      {
        id: 101,
        kind: "element",
        tagName: "section",
        attributes: [],
        children: [
          {
            id: 102,
            kind: "element",
            tagName: "h1",
            attributes: [],
            children: [{ id: 103, kind: "text", value: "Heading" }]
          }
        ]
      }
    ],
    errors: []
  };

  return tree;
}

function withBudgetCheck(checks, id, budget, execute) {
  try {
    execute();
    checks.push({
      id,
      ok: false,
      expectedErrorCode: "BUDGET_EXCEEDED",
      observedErrorCode: "NONE"
    });
  } catch (error) {
    const observed = error instanceof BudgetExceededError ? error.payload.budget : "UNEXPECTED_ERROR";
    checks.push({
      id,
      ok: observed === budget,
      expectedErrorCode: budget,
      observedErrorCode: observed
    });
  }
}

async function withAsyncBudgetCheck(checks, id, budget, execute) {
  try {
    await execute();
    checks.push({
      id,
      ok: false,
      expectedErrorCode: "BUDGET_EXCEEDED",
      observedErrorCode: "NONE"
    });
  } catch (error) {
    const observed = error instanceof BudgetExceededError ? error.payload.budget : "UNEXPECTED_ERROR";
    checks.push({
      id,
      ok: observed === budget,
      expectedErrorCode: budget,
      observedErrorCode: observed
    });
  }
}

async function maybeRuntimeVersion(command, args = []) {
  try {
    const result = await execFileAsync(command, args, { timeout: 4000 });
    const line = (result.stdout || "").split(/\r?\n/)[0]?.trim() || "unknown";
    return { ok: true, version: line };
  } catch {
    return { ok: false, pending: true };
  }
}

async function writeDeterminism() {
  const cases = [];

  const documentHashes = [];
  for (let i = 0; i < 5; i += 1) {
    documentHashes.push(sha256(JSON.stringify(parse("<h1>alpha</h1>", { trace: true }))));
  }

  const fragmentHashes = [];
  for (let i = 0; i < 5; i += 1) {
    fragmentHashes.push(sha256(JSON.stringify(parseFragment("beta", "section", { includeSpans: true, trace: true }))));
  }

  const docUnique = [...new Set(documentHashes)];
  const fragUnique = [...new Set(fragmentHashes)];

  cases.push({
    id: "det-document-1",
    ok: docUnique.length === 1,
    hashes: {
      node: docUnique[0] || ""
    }
  });

  cases.push({
    id: "det-fragment-1",
    ok: fragUnique.length === 1,
    hashes: {
      node: fragUnique[0] || ""
    }
  });

  await writeJson("reports/determinism.json", {
    suite: "determinism",
    timestamp: new Date().toISOString(),
    cases,
    overall: {
      ok: cases.every((entry) => entry.ok),
      strategy: "deterministic pre-order incremental NodeId assignment"
    }
  });
}

async function writeBudgets() {
  const checks = [];

  withBudgetCheck(checks, "budget-max-input-bytes", "maxInputBytes", () => {
    parse("abcdef", { budgets: { maxInputBytes: 3 } });
  });

  withBudgetCheck(checks, "budget-max-nodes", "maxNodes", () => {
    parse("abcdef", { budgets: { maxNodes: 2 } });
  });

  withBudgetCheck(checks, "budget-max-depth", "maxDepth", () => {
    parse("abcdef", { budgets: { maxDepth: 1 } });
  });

  withBudgetCheck(checks, "budget-max-trace-events", "maxTraceEvents", () => {
    parse("abcdef", { trace: true, budgets: { maxTraceEvents: 2 } });
  });

  withBudgetCheck(checks, "budget-max-trace-bytes", "maxTraceBytes", () => {
    parse("abcdef", { trace: true, budgets: { maxTraceBytes: 20 } });
  });

  withBudgetCheck(checks, "budget-max-time-ms", "maxTimeMs", () => {
    parse("abcdef", { budgets: { maxTimeMs: -1 } });
  });

  await withAsyncBudgetCheck(checks, "budget-max-buffered-bytes", "maxBufferedBytes", async () => {
    const stream = makeStream([new Uint8Array([0x41, 0x42, 0x43])]);
    await parseStream(stream, { budgets: { maxBufferedBytes: 2 } });
  });

  await writeJson("reports/budgets.json", {
    suite: "budgets",
    timestamp: new Date().toISOString(),
    overall: {
      ok: checks.every((entry) => entry.ok)
    },
    checks
  });
}

async function writeStream() {
  const checks = [];

  const prefix = "<meta charset=windows-1252><p>";
  const suffix = "</p>";
  const bytes = new Uint8Array([...asciiBytes(prefix), 0xe9, ...asciiBytes(suffix)]);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 3) {
    chunks.push(bytes.subarray(offset, Math.min(bytes.length, offset + 3)));
  }

  const fromBytes = parseBytes(bytes);
  const fromStream = await parseStream(makeStream(chunks));
  const fromBytesHash = sha256(JSON.stringify(fromBytes));
  const fromStreamHash = sha256(JSON.stringify(fromStream));

  checks.push({
    id: "stream-many-chunks-equals-parse-bytes",
    ok: fromStreamHash === fromBytesHash,
    observed: { hash: fromStreamHash, chunks: chunks.length },
    expected: { hash: fromBytesHash }
  });

  const tiny = new Uint8Array(40).fill(0x61);
  const tinyChunks = [...tiny].map((value) => new Uint8Array([value]));
  let observedBudget = "none";
  let observedActual = -1;

  try {
    await parseStream(makeStream(tinyChunks), { budgets: { maxBufferedBytes: 16 } });
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      observedBudget = error.payload.budget;
      observedActual = error.payload.actual;
    }
  }

  checks.push({
    id: "stream-max-buffered-bytes-fails-before-overrun",
    ok: observedBudget === "maxBufferedBytes" && observedActual === 17,
    observed: { budget: observedBudget, actual: observedActual },
    expected: { budget: "maxBufferedBytes", actual: 17 }
  });

  await writeJson("reports/stream.json", {
    suite: "stream",
    timestamp: new Date().toISOString(),
    overall: {
      ok: checks.every((entry) => entry.ok)
    },
    checks
  });
}

async function writeSmoke() {
  const node = { ok: true, version: process.version };
  const deno = await maybeRuntimeVersion("deno", ["--version"]);
  const bun = await maybeRuntimeVersion("bun", ["--version"]);

  await writeJson("reports/smoke.json", {
    suite: "smoke",
    timestamp: new Date().toISOString(),
    runtimes: {
      node,
      deno,
      bun,
      browser: { ok: false, pending: true }
    }
  });
}

async function writeAgent() {
  const traced = parse("agent", { trace: true, budgets: { maxTraceEvents: 20, maxTraceBytes: 4096 } });
  const withSpans = parse("agent", { includeSpans: true });
  const heading = headingTree();
  const headingOutline = outline(heading);
  const chunks = chunk(heading, { maxChars: 8, maxNodes: 2 });
  const traceEvents = Array.isArray(traced.trace) ? traced.trace : [];
  const requiredKinds = new Set(["decode", "token", "insertion-mode", "tree-mutation"]);

  const traceSchemaOk = traceEvents.every((event) => {
    if (event === null || typeof event !== "object") {
      return false;
    }
    if (typeof event.seq !== "number" || event.seq < 1 || typeof event.kind !== "string") {
      return false;
    }

    if (event.kind === "decode") {
      return typeof event.source === "string" && typeof event.encoding === "string" && typeof event.sniffSource === "string";
    }
    if (event.kind === "token") {
      return typeof event.count === "number";
    }
    if (event.kind === "insertion-mode") {
      return typeof event.mode === "string";
    }
    if (event.kind === "tree-mutation") {
      return typeof event.nodeCount === "number" && typeof event.errorCount === "number";
    }
    if (event.kind === "parse-error") {
      return typeof event.code === "string";
    }
    if (event.kind === "budget") {
      return typeof event.budget === "string" && typeof event.actual === "number";
    }
    if (event.kind === "stream") {
      return typeof event.bytesRead === "number";
    }

    return false;
  });

  const traceKinds = new Set(traceEvents.map((event) => event.kind));
  const traceKindsOk = [...requiredKinds].every((kind) => traceKinds.has(kind));

  await writeJson("reports/agent.json", {
    suite: "agent",
    timestamp: new Date().toISOString(),
    features: {
      trace: {
        ok: traceEvents.length > 0 && traceSchemaOk && traceKindsOk,
        bounded: traceEvents.length <= 20,
        tested: true
      },
      spans: {
        ok: Boolean(withSpans.children[0]?.span),
        tested: true
      },
      outline: {
        ok: headingOutline.entries.length > 0,
        tested: true
      },
      chunk: {
        ok: chunks.length >= 1 && chunks.every((entry) => entry.nodes > 0),
        tested: true
      }
    }
  });
}

await writeDeterminism();
await writeBudgets();
await writeStream();
await writeSmoke();
await writeAgent();
