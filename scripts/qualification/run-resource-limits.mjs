import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { parseLongOptions } from "../lib/cli.mjs";
import { writeJson } from "../lib/report.mjs";

const options = parseLongOptions(process.argv.slice(2), {
  worker: { type: "string" },
  bounded: { type: "boolean", default: false },
  report: { type: "string", default: "reports/resource-limits.json" }
}, "resource-limit qualification");
const workerCase = options.worker;
const bounded = options.bounded;

function fixture(name) {
  if (name === "nodes") {
    return {
      input: `<main>${"<p>x</p>".repeat(12_000)}</main>`,
      run(mod, input) {
        return mod.parse(input, bounded ? { budgets: { maxNodes: 128 } } : {});
      },
      expectedBudget: "maxNodes",
      expectedLimit: 128
    };
  }
  if (name === "attributes") {
    const attributes = Array.from({ length: 20_000 }, (_, index) => `a${String(index)}=v`).join(" ");
    return {
      input: `<x ${attributes}>`,
      run(mod, input) {
        return mod.parse(
          input,
          bounded ? { budgets: { maxAttributesPerElement: 128 } } : {}
        );
      },
      expectedBudget: "maxAttributesPerElement",
      expectedLimit: 128
    };
  }
  if (name === "errors") {
    return {
      input: "\0".repeat(20_000),
      run(mod, input) {
        return mod.parse(input, bounded ? { budgets: { maxParseErrors: 128 } } : {});
      },
      expectedBudget: "maxParseErrors",
      expectedLimit: 128
    };
  }
  if (name === "decoded-output") {
    return {
      input: new Uint8Array(4 * 1024 * 1024).fill(0x61),
      run(mod, input) {
        return mod.parseBytes(
          input,
          bounded ? { budgets: { maxDecodedUtf8Bytes: 65_536 } } : {}
        );
      },
      expectedBudget: "maxDecodedUtf8Bytes",
      expectedLimit: 65_536
    };
  }
  if (name === "byte-source-none" || name === "byte-source-text") {
    const sourceRetention = name === "byte-source-none" ? "none" : "text";
    return {
      input: new Uint8Array(8 * 1024 * 1024).fill(0x20),
      collectAfterRun: true,
      run(mod, input) {
        return mod.parseBytes(input, { sourceRetention });
      }
    };
  }
  if (name === "trace") {
    return {
      input: "\0".repeat(2_000),
      run(mod, input) {
        return mod.parse(
          input,
          bounded ? { trace: "events", budgets: { maxTraceEvents: 128 } } : { trace: "events" }
        );
      },
      expectedBudget: "maxTraceEvents",
      expectedLimit: 128
    };
  }
  throw new Error(`Unknown hard-budget fixture: ${String(name)}`);
}

if (workerCase) {
  if (typeof globalThis.gc !== "function") {
    throw new Error("hard-budget evidence workers require --expose-gc");
  }
  const mod = await import("../../dist/mod.js");
  const selected = fixture(workerCase);
  globalThis.gc();
  const before = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const startedAt = performance.now();
  let retainedResult;
  let failure;
  try {
    retainedResult = selected.run(mod, selected.input);
  } catch (error) {
    failure = error;
  }
  const wallMs = performance.now() - startedAt;
  const cpu = process.cpuUsage(cpuBefore);
  if (selected.collectAfterRun === true) globalThis.gc();
  const after = process.memoryUsage();
  const peakRssBytes = process.resourceUsage().maxRSS * 1024;

  if (bounded) {
    if (!mod.isHtmlBudgetExceededError(failure)) {
      throw new Error(`${workerCase}: bounded run did not throw a classified budget failure`);
    }
    if (
      failure.budget !== selected.expectedBudget ||
      failure.limit !== selected.expectedLimit ||
      failure.actual !== selected.expectedLimit + 1
    ) {
      throw new Error(`${workerCase}: bounded run reported the wrong first failing unit`);
    }
  } else if (failure !== undefined) {
    throw failure;
  }

  const inputBytes = selected.input instanceof Uint8Array
    ? selected.input.byteLength
    : new TextEncoder().encode(selected.input).byteLength;
  const report = {
    fixture: workerCase,
    bounded,
    inputBytes,
    wallMs: Number(wallMs.toFixed(3)),
    cpuMs: Number(((cpu.user + cpu.system) / 1_000).toFixed(3)),
    heapUsedBeforeBytes: before.heapUsed,
    heapUsedAfterBytes: after.heapUsed,
    retainedHeapDeltaBytes: Math.max(0, after.heapUsed - before.heapUsed),
    peakRssBytes,
    outcome: bounded
      ? {
          code: failure.code,
          budget: failure.budget,
          limit: failure.limit,
          actual: failure.actual
        }
      : { code: "OK" },
    retainedResultKind: retainedResult?.tree?.kind ?? retainedResult?.kind ?? null,
    retainedSourceCodeUnits: retainedResult?.sourceText?.length ?? 0
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(0);
}

const fixtureNames = ["nodes", "attributes", "errors", "decoded-output", "trace"];
const comparisons = [];

function runWorker(name, isBounded = false) {
  const result = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      fileURLToPath(import.meta.url),
      `--worker=${name}`,
      ...(isBounded ? ["--bounded"] : [])
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error(`${name}/${isBounded ? "bounded" : "unbounded"} worker failed:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim());
}

for (const name of fixtureNames) {
  const runs = {
    unbounded: runWorker(name),
    bounded: runWorker(name, true)
  };
  if (runs.bounded.retainedHeapDeltaBytes >= runs.unbounded.retainedHeapDeltaBytes) {
    throw new Error(`${name}: bounded retained heap was not lower than the unbounded run`);
  }
  comparisons.push({
    fixture: name,
    unbounded: runs.unbounded,
    bounded: runs.bounded,
    retainedHeapReductionBytes:
      runs.unbounded.retainedHeapDeltaBytes - runs.bounded.retainedHeapDeltaBytes
  });
}

const byteSourceRetention = {
  none: runWorker("byte-source-none"),
  text: runWorker("byte-source-text")
};
if (byteSourceRetention.none.retainedSourceCodeUnits !== 0 ||
    byteSourceRetention.text.retainedSourceCodeUnits !== byteSourceRetention.text.inputBytes) {
  throw new Error("byte source-retention workers returned the wrong public source shape");
}
if (byteSourceRetention.none.retainedHeapDeltaBytes >=
    byteSourceRetention.text.retainedHeapDeltaBytes) {
  throw new Error("byte parsing without source retention did not retain less heap");
}

const report = {
  schemaVersion: 1,
  suite: "html-parser-resource-limits",
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    explicitGc: true
  },
  method: {
    isolation: "one fresh process for each bounded or unbounded fixture",
    baseline: "explicit GC after fixture construction and before the parse",
    retainedHeap: "heapUsed sampled immediately after synchronous return or throw",
    sourceRetentionHeap: "heapUsed sampled after explicit post-parse GC for byte source-retention fixtures",
    peakRss: "process.resourceUsage().maxRSS high-water mark",
    assertion: "hard budgets fail at limit + 1 and byte parsing retains decoded source only when requested"
  },
  comparisons,
  byteSourceRetention: {
    ...byteSourceRetention,
    retainedHeapReductionBytes:
      byteSourceRetention.text.retainedHeapDeltaBytes -
      byteSourceRetention.none.retainedHeapDeltaBytes
  }
};

await writeJson(options.report, report);
console.log(JSON.stringify(report, null, 2));
