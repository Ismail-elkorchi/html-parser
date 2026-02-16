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
import { writeJson } from "./eval-primitives.mjs";

const execFileAsync = promisify(execFile);

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function asciiBytes(value) {
  return Array.from(value, (char) => char.charCodeAt(0));
}

function makeReadableByteStream(chunkList) {
  const streamFactory = globalThis.ReadableStream;
  if (typeof streamFactory !== "function") {
    throw new Error("ReadableStream is not available in this runtime");
  }

  return new streamFactory({
    start(controller) {
      for (const chunkValue of chunkList) {
        controller.enqueue(chunkValue);
      }
      controller.close();
    }
  });
}

function makePullCountStream(chunkList, pullCounter) {
  const streamFactory = globalThis.ReadableStream;
  if (typeof streamFactory !== "function") {
    throw new Error("ReadableStream is not available in this runtime");
  }

  let offset = 0;
  return new streamFactory({
    pull(controller) {
      pullCounter.count += 1;
      const chunkValue = chunkList[offset];
      offset += 1;
      if (chunkValue === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(chunkValue);
    }
  }, { highWaterMark: 0 });
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

function assertBudgetErrorSync(checks, checkId, budgetKey, executeCheck) {
  try {
    executeCheck();
    checks.push({
      id: checkId,
      ok: false,
      expectedErrorCode: "BUDGET_EXCEEDED",
      observedErrorCode: "NONE"
    });
  } catch (error) {
    const observedBudgetKey = error instanceof BudgetExceededError ? error.payload.budget : "UNEXPECTED_ERROR";
    checks.push({
      id: checkId,
      ok: observedBudgetKey === budgetKey,
      expectedErrorCode: budgetKey,
      observedErrorCode: observedBudgetKey
    });
  }
}

async function assertBudgetErrorAsync(checks, checkId, budgetKey, executeCheck) {
  try {
    await executeCheck();
    checks.push({
      id: checkId,
      ok: false,
      expectedErrorCode: "BUDGET_EXCEEDED",
      observedErrorCode: "NONE"
    });
  } catch (error) {
    const observedBudgetKey = error instanceof BudgetExceededError ? error.payload.budget : "UNEXPECTED_ERROR";
    checks.push({
      id: checkId,
      ok: observedBudgetKey === budgetKey,
      expectedErrorCode: budgetKey,
      observedErrorCode: observedBudgetKey
    });
  }
}

async function detectRuntimeVersion(command, args = []) {
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
  for (let sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
    documentHashes.push(sha256(JSON.stringify(parse("<h1>alpha</h1>", { trace: true }))));
  }

  const fragmentHashes = [];
  for (let sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
    fragmentHashes.push(sha256(JSON.stringify(parseFragment("beta", "section", { includeSpans: true, trace: true }))));
  }

  const uniqueDocumentHashes = [...new Set(documentHashes)];
  const uniqueFragmentHashes = [...new Set(fragmentHashes)];

  cases.push({
    id: "det-document-1",
    ok: uniqueDocumentHashes.length === 1,
    hashes: {
      node: uniqueDocumentHashes[0] || ""
    }
  });

  cases.push({
    id: "det-fragment-1",
    ok: uniqueFragmentHashes.length === 1,
    hashes: {
      node: uniqueFragmentHashes[0] || ""
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

  assertBudgetErrorSync(checks, "budget-max-input-bytes", "maxInputBytes", () => {
    parse("abcdef", { budgets: { maxInputBytes: 3 } });
  });

  assertBudgetErrorSync(checks, "budget-max-nodes", "maxNodes", () => {
    parse("abcdef", { budgets: { maxNodes: 2 } });
  });

  assertBudgetErrorSync(checks, "budget-max-depth", "maxDepth", () => {
    parse("abcdef", { budgets: { maxDepth: 1 } });
  });

  assertBudgetErrorSync(checks, "budget-max-trace-events", "maxTraceEvents", () => {
    parse("abcdef", { trace: true, budgets: { maxTraceEvents: 2 } });
  });

  assertBudgetErrorSync(checks, "budget-max-trace-bytes", "maxTraceBytes", () => {
    parse("abcdef", { trace: true, budgets: { maxTraceBytes: 20 } });
  });

  assertBudgetErrorSync(checks, "budget-max-time-ms", "maxTimeMs", () => {
    parse("abcdef", { budgets: { maxTimeMs: -1 } });
  });

  await assertBudgetErrorAsync(checks, "budget-max-buffered-bytes", "maxBufferedBytes", async () => {
    const stream = makeReadableByteStream([new Uint8Array([0x41, 0x42, 0x43])]);
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
  const fromStream = await parseStream(makeReadableByteStream(chunks));
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
    await parseStream(makeReadableByteStream(tinyChunks), { budgets: { maxBufferedBytes: 16 } });
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

  const pullCounter = { count: 0 };
  const inputBudgetChunks = [new Uint8Array(4).fill(0x61), new Uint8Array(4).fill(0x62), new Uint8Array(4).fill(0x63)];
  let inputBudgetError = "none";
  try {
    await parseStream(
      makePullCountStream(inputBudgetChunks, pullCounter),
      { budgets: { maxInputBytes: 6, maxBufferedBytes: 64 } }
    );
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      inputBudgetError = error.payload.budget;
    }
  }

  checks.push({
    id: "stream-max-input-bytes-aborts-before-extra-pulls",
    ok: inputBudgetError === "maxInputBytes" && pullCounter.count === 2,
    observed: { budget: inputBudgetError, pulls: pullCounter.count },
    expected: { budget: "maxInputBytes", pulls: 2 }
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
  const deno = await detectRuntimeVersion("deno", ["--version"]);
  const bun = await detectRuntimeVersion("bun", ["--version"]);

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
  const tracedDocument = parse("agent", { trace: true, budgets: { maxTraceEvents: 20, maxTraceBytes: 4096 } });
  const documentWithSpans = parse("agent", { includeSpans: true });
  const headingDocument = headingTree();
  const headingOutline = outline(headingDocument);
  const chunkPlan = chunk(headingDocument, { maxChars: 8, maxNodes: 2 });
  const traceEvents = Array.isArray(tracedDocument.trace) ? tracedDocument.trace : [];
  const requiredKinds = new Set(["decode", "token", "insertionModeTransition", "tree-mutation"]);

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
    if (event.kind === "insertionModeTransition") {
      return (
        typeof event.fromMode === "string" &&
        typeof event.toMode === "string" &&
        event.tokenContext !== null &&
        typeof event.tokenContext === "object"
      );
    }
    if (event.kind === "tree-mutation") {
      return typeof event.nodeCount === "number" && typeof event.errorCount === "number";
    }
    if (event.kind === "parseError") {
      return typeof event.parseErrorId === "string";
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
        ok: Boolean(documentWithSpans.children[0]?.span),
        tested: true
      },
      outline: {
        ok: headingOutline.entries.length > 0,
        tested: true
      },
      chunk: {
        ok: chunkPlan.length >= 1 && chunkPlan.every((entry) => entry.nodes > 0),
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
