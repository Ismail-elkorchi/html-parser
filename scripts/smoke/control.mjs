import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  HTML_NAMESPACE_URI,
  HtmlAbortError,
  HtmlBudgetExceededError,
  isHtmlAbortError,
  isHtmlBudgetExceededError,
  chunk,
  outline,
  parse,
  parseBytes,
  parseFragment,
  parseStream,
  serialize,
  tokenizeByteStreamEager
} from "../../dist/mod.js";
import { parseLongOptions } from "../lib/cli.mjs";

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function ensureWebCrypto() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto subtle API is unavailable in this runtime");
  }
  return subtle;
}

function toHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const subtle = ensureWebCrypto();
  const payload = new TextEncoder().encode(value);
  const digest = await subtle.digest("SHA-256", payload);
  return toHex(new Uint8Array(digest));
}

function normalizeSpan(spanValue) {
  if (!spanValue || typeof spanValue !== "object") {
    return null;
  }
  const normalized = {};
  if (typeof spanValue.start === "number") {
    normalized.start = spanValue.start;
  }
  if (typeof spanValue.end === "number") {
    normalized.end = spanValue.end;
  }
  return Object.keys(normalized).length === 0 ? null : normalized;
}

function normalizeAttribute(attribute) {
  const normalized = {
    namespaceUri: attribute.namespaceUri === null ? null : String(attribute.namespaceUri || ""),
    localName: String(attribute.localName || ""),
    value: String(attribute.value || "")
  };
  if (attribute.span) {
    normalized.span = normalizeSpan(attribute.span);
  }
  return normalized;
}

function normalizeNode(node) {
  const normalized = {
    id: Number(node.id),
    kind: String(node.kind || "")
  };

  if (typeof node.localName === "string") {
    normalized.namespaceUri = String(node.namespaceUri || "");
    normalized.localName = node.localName;
  }
  if (typeof node.value === "string") {
    normalized.value = node.value;
  }
  if (Array.isArray(node.attributes)) {
    normalized.attributes = node.attributes.map((attribute) => normalizeAttribute(attribute));
  }
  if (node.span) {
    normalized.span = normalizeSpan(node.span);
  }
  if (typeof node.spanProvenance === "string") {
    normalized.spanProvenance = node.spanProvenance;
  }
  if (Array.isArray(node.children)) {
    normalized.children = node.children.map((childNode) => normalizeNode(childNode));
  }

  return normalized;
}

function normalizeParseError(parseError) {
  const normalized = {
    parseErrorId: String(parseError.parseErrorId || "")
  };
  if (typeof parseError.message === "string") {
    normalized.message = parseError.message;
  }
  if (typeof parseError.offset === "number") {
    normalized.offset = parseError.offset;
  }
  if (typeof parseError.nodeId === "number") {
    normalized.nodeId = parseError.nodeId;
  }
  return normalized;
}

async function computeDeterminismHash() {
  const deterministicInput = "<!doctype html><title>x</title><body><p a='1'>txt<span></p></body>";
  const parsed = parse(deterministicInput, {
    captureSpans: true
  }).tree;

  const canonicalPayload = {
    node: normalizeNode(parsed),
    parseErrors: Array.isArray(parsed.errors) ? parsed.errors.map((entry) => normalizeParseError(entry)) : []
  };

  return sha256Hex(JSON.stringify(canonicalPayload));
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
  const { tree: parsed } = parse("<p>smoke</p>");
  ensure(parsed.kind === "document", "parse root type mismatch");
  ensure(
    serialize(parsed) === "<html><head></head><body><p>smoke</p></body></html>",
    "parse output mismatch"
  );

  const { tree: fromBytes } = parseBytes(new Uint8Array([0x68, 0x74, 0x6d, 0x6c]));
  ensure(
    serialize(fromBytes) === "<html><head></head><body>html</body></html>",
    "parseBytes decoding mismatch"
  );

  const serialized = serialize(parsed);
  ensure(serialized === "<html><head></head><body><p>smoke</p></body></html>", "serialize mismatch");

  const first = parse("deterministic");
  const second = parse("deterministic");
  ensure(JSON.stringify(first) === JSON.stringify(second), "deterministic output mismatch");

  const fragment = parseFragment("child", {
    namespaceUri: HTML_NAMESPACE_URI,
    localName: "section"
  });
  ensure(fragment.context.localName === "section", "fragment context mismatch");

  const sampleBytes = new Uint8Array([
    0x3c, 0x6d, 0x65, 0x74, 0x61, 0x20, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x3d, 0x77, 0x69, 0x6e, 0x64,
    0x6f, 0x77, 0x73, 0x2d, 0x31, 0x32, 0x35, 0x32, 0x3e, 0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e
  ]);

  const streamResult = (await parseStream(
    createByteStream([sampleBytes.subarray(0, 9), sampleBytes.subarray(9, 21), sampleBytes.subarray(21)])
  )).tree;
  const bytesResult = parseBytes(sampleBytes).tree;
  ensure(
    JSON.stringify(streamResult) === JSON.stringify(bytesResult),
    "parseStream output mismatch vs parseBytes"
  );

  const tokenKinds = (await tokenizeByteStreamEager(
    createByteStream([new TextEncoder().encode("<p>smoke</p>")])
  )).map((token) => token.kind);
  ensure(
    JSON.stringify(tokenKinds) === JSON.stringify(["startTag", "chars", "endTag", "eof"]),
    "tokenizeByteStreamEager mismatch"
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

  ensure(budgetError instanceof HtmlBudgetExceededError, "expected HtmlBudgetExceededError");
  ensure(isHtmlBudgetExceededError(budgetError), "expected structural budget classification");
  ensure(budgetError.code === "BUDGET_EXCEEDED", "expected structured budget code");
  ensure(budgetError.budget === "maxInputBytes", "expected direct budget field");

  const abortReason = { source: "smoke" };
  const abortController = new globalThis.AbortController();
  abortController.abort(abortReason);
  let abortError = null;
  try {
    parse("abort", { signal: abortController.signal });
  } catch (error) {
    abortError = error;
  }
  ensure(abortError instanceof HtmlAbortError, "expected HtmlAbortError");
  ensure(isHtmlAbortError(abortError), "expected structural abort classification");
  ensure(abortError.code === "ABORTED", "expected structured abort code");
  ensure(abortError.cause === abortReason, "expected exact abort reason");
}

async function main() {
  const args = parseLongOptions(process.argv.slice(2), {
    runtime: { type: "string" },
    report: { type: "string" }
  }, "runtime smoke");
  const runtime = resolveRuntime(args.runtime ?? null);
  const generatedAt = new Date().toISOString();

  let failure = null;
  let determinismHash = null;
  try {
    await runSmokeAssertions();
    determinismHash = await computeDeterminismHash();
  } catch (error) {
    failure = error;
  }

  if (args.report !== undefined) {
    await writeReport(args.report, {
      schemaVersion: 1,
      suite: "html-parser-runtime-smoke",
      runtime,
      generatedAt,
      ok: failure === null,
      version: runtimeVersion(runtime),
      determinismHash,
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
