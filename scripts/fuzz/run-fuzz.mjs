import { fork } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { HtmlBudgetExceededError, parse } from "../../dist/mod.js";
import { writeJson } from "../eval/eval-primitives.mjs";

const RUNS = 600;
const SEED = 0x9e3779b9;
const SLOW_OBSERVATION_MS = 25;
const CASE_WATCHDOG_MS = Number(process.env["ENGINE_FUZZ_WATCHDOG_MS"] ?? 2_000);
if (!Number.isSafeInteger(CASE_WATCHDOG_MS) || CASE_WATCHDOG_MS < 10) {
  throw new Error("ENGINE_FUZZ_WATCHDOG_MS must be a safe integer of at least 10");
}
const PROTOCOL_WATCHDOG_MS = Math.max(5_000, CASE_WATCHDOG_MS);
const TOP_SLOWEST = 12;

const ELEMENT_NAMES = [
  "div",
  "span",
  "p",
  "a",
  "section",
  "article",
  "ul",
  "li",
  "table",
  "tbody",
  "tr",
  "td",
  "dl",
  "dt",
  "dd"
];
const ATTRIBUTE_NAMES = ["class", "id", "data-x", "data-y", "title", "lang", "dir", "style"];
const ATTRIBUTE_VALUES = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "x y",
  "line\nbreak",
  "tab\tsep",
  "<unsafe>",
  "\"quoted\"",
  "'single'"
];
const TEXT_ATOMS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "&amp;",
  "&lt;tag&gt;",
  "x\u0000y",
  "NFC-\u00E9",
  "NFD-e\u0301"
];
const SPACE_VARIANTS = [" ", "  ", "\n", "\t"];
const JOINER_VARIANTS = ["=", " = ", "=\t", " =\n "];

function nextSeed(seed) {
  return (Math.imul(seed, 1103515245) + 12345) >>> 0;
}

function createRng(seed) {
  let state = seed >>> 0;

  const nextUInt = () => {
    state = nextSeed(state);
    return state;
  };

  const int = (max) => {
    if (max <= 0) {
      return 0;
    }
    return nextUInt() % max;
  };

  const bool = (percent) => int(100) < percent;

  return {
    nextUInt,
    int,
    bool
  };
}

function pick(rng, values) {
  return values[rng.int(values.length)] ?? values[0];
}

function escapeAttributeValue(value, quote) {
  let escaped = value.replace(/&/g, "&amp;");
  if (quote === "\"") {
    escaped = escaped.replace(/"/g, "&quot;");
  } else {
    escaped = escaped.replace(/'/g, "&#39;");
  }
  return escaped;
}

function renderAttribute(rng, index) {
  const duplicate = rng.bool(30);
  const nameBase = pick(rng, ATTRIBUTE_NAMES);
  const name = duplicate ? nameBase : `${nameBase}-${index}`;
  const rawValue = pick(rng, ATTRIBUTE_VALUES);
  const quote = rng.bool(50) ? "\"" : "'";
  const value = escapeAttributeValue(rawValue, quote);
  const joiner = pick(rng, JOINER_VARIANTS);
  return `${name}${joiner}${quote}${value}${quote}`;
}

function renderOpenTag(rng, tagName, depth) {
  const attributeCount = 1 + rng.int(4);
  const attributes = [];
  for (let attributeIndex = 0; attributeIndex < attributeCount; attributeIndex += 1) {
    attributes.push(renderAttribute(rng, depth + attributeIndex));
    if (rng.bool(20)) {
      attributes.push(renderAttribute(rng, depth + attributeIndex));
    }
  }

  const separator = pick(rng, SPACE_VARIANTS);
  return `<${tagName}${separator}${attributes.join(separator)}>`;
}

function renderText(rng, runIndex) {
  return `${pick(rng, TEXT_ATOMS)}-${runIndex}-${rng.int(10_000)}`;
}

function generateStructuredHtml(seed, runIndex) {
  const rng = createRng(seed);
  const parts = [];
  const stack = [];

  if (rng.bool(35)) {
    parts.push("<!doctype html>");
  }
  if (rng.bool(50)) {
    parts.push(`<!-- fuzz-${runIndex}-lead -->`);
  }

  const depth = 2 + rng.int(6);
  for (let level = 0; level < depth; level += 1) {
    const tagName = pick(rng, ELEMENT_NAMES);
    parts.push(renderOpenTag(rng, tagName, level));
    stack.push(tagName);

    if (rng.bool(80)) {
      parts.push(renderText(rng, runIndex));
    }
    if (rng.bool(25)) {
      parts.push(`<!-- mid-${runIndex}-${level} -->`);
    }
    if (rng.bool(15)) {
      parts.push(`<${pick(rng, ELEMENT_NAMES)}>${renderText(rng, runIndex)}`);
    }
  }

  if (rng.bool(60)) {
    parts.push(
      `<svg><g><title>s${runIndex}</title><foreignObject><p>foreign${runIndex}</p></foreignObject></g></svg>`
    );
  }
  if (rng.bool(60)) {
    parts.push(`<math><mi>x${runIndex}</mi><mo>+</mo><mi>y${runIndex}</mi></math>`);
  }
  if (rng.bool(45)) {
    parts.push(`<template><div>t${runIndex}</div><table><tr><td>c${runIndex}</td></tr></table></template>`);
  }
  if (rng.bool(35)) {
    parts.push(`<table><tr><td>a${runIndex}</td></tr>outside${runIndex}<tr><td>b${runIndex}</td></tr></table>`);
  }
  if (rng.bool(40)) {
    parts.push(`<script>document.write('<p id="f${runIndex}">x</p>')</script>`);
  }

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const expected = stack[index];
    if (rng.bool(12)) {
      continue;
    }
    if (rng.bool(10)) {
      parts.push(`</${pick(rng, ELEMENT_NAMES)}>`);
      continue;
    }
    parts.push(`</${expected}>`);
  }

  if (rng.bool(25)) {
    parts.push(`</div><p data-broken='tail-${runIndex}'>tail-${runIndex}`);
  }
  if (rng.bool(30)) {
    parts.push(`<!-- fuzz-${runIndex}-tail -->`);
  }

  return parts.join("");
}

function parseWithProfile(html, budgetProfile) {
  if (budgetProfile === "tight") {
    return parse(html, {
      trace: "events",
      budgets: {
        maxInputBytes: 2048,
        maxNodes: 40,
        maxDepth: 10,
        maxTraceEvents: 24,
        maxTraceBytes: 2048,
        maxTimeMs: 100
      }
    });
  }

  return parse(html, {
    trace: "events",
    budgets: {
      maxInputBytes: 8192,
      maxNodes: 256,
      maxDepth: 48,
      maxTraceEvents: 96,
      maxTraceBytes: 8192,
      maxTimeMs: 100
    }
  });
}

function runCampaign() {
  let crashes = 0;
  let budgetErrors = 0;
  let normalParses = 0;
  let nondeterministicOutcomes = 0;
  const findings = [];
  const slowCases = [];
  let state = SEED;

  for (let run = 0; run < RUNS; run += 1) {
    state = nextSeed(state);
    const caseSeed = state;
    const budgetProfile = run % 4 === 0 ? "tight" : "default";
    const html = generateStructuredHtml(caseSeed, run);
    const caseId = `fuzz-${String(run + 1).padStart(4, "0")}`;
    process.send?.({ kind: "case-start", id: caseId, run, seed: `0x${caseSeed.toString(16)}` });

    const started = performance.now();
    let outcome = "normal";
    try {
      const first = parseWithProfile(html, budgetProfile);
      const second = parseWithProfile(html, budgetProfile);
      normalParses += 1;

      if (JSON.stringify(first) !== JSON.stringify(second)) {
        nondeterministicOutcomes += 1;
        findings.push({
          id: caseId,
          seed: `0x${caseSeed.toString(16)}`,
          type: "nondeterministic",
          budgetProfile,
          inputPreview: html.slice(0, 220)
        });
      }
    } catch (error) {
      if (error instanceof HtmlBudgetExceededError) {
        budgetErrors += 1;
        outcome = "budget-error";
      } else {
        crashes += 1;
        outcome = "crash";
        findings.push({
          id: caseId,
          seed: `0x${caseSeed.toString(16)}`,
          type: "crash",
          budgetProfile,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const elapsed = performance.now() - started;
    slowCases.push({
      id: caseId,
      seed: `0x${caseSeed.toString(16)}`,
      budgetProfile,
      elapsedMs: Number(elapsed.toFixed(3)),
      outcome
    });
    process.send?.({ kind: "case-complete", id: caseId, run });
  }

  slowCases.sort((left, right) => right.elapsedMs - left.elapsedMs || left.id.localeCompare(right.id));
  return {
    schemaVersion: 2,
    suite: "html-parser-fuzz",
    timestamp: new Date().toISOString(),
    runs: RUNS,
    seed: `0x${SEED.toString(16)}`,
    crashes,
    hangs: 0,
    nondeterministicOutcomes,
    budgetErrors,
    outcomeDistribution: { normalParses, budgetErrors, crashes },
    slowObservationThresholdMs: SLOW_OBSERVATION_MS,
    slowObservations: slowCases.filter((entry) => entry.elapsedMs > SLOW_OBSERVATION_MS).length,
    topSlowCases: slowCases.slice(0, TOP_SLOWEST),
    findings
  };
}

function runCampaignWithWatchdog(workerArguments = ["--worker"]) {
  return new Promise((resolve) => {
    const child = fork(fileURLToPath(import.meta.url), workerArguments, {
      stdio: ["ignore", "inherit", "inherit", "ipc"]
    });
    let settled = false;
    let currentCase = null;
    let completedRuns = 0;
    let timer;
    let watchdogPhase = "worker-startup";
    let watchdogTimeoutMs = PROTOCOL_WATCHDOG_MS;

    const armWatchdog = (phase, timeoutMs) => {
      globalThis.clearTimeout(timer);
      watchdogPhase = phase;
      watchdogTimeoutMs = timeoutMs;
      timer = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({
          schemaVersion: 2,
          suite: "html-parser-fuzz",
          timestamp: new Date().toISOString(),
          runs: RUNS,
          completedRuns,
          seed: `0x${SEED.toString(16)}`,
          crashes: 0,
          hangs: 1,
          nondeterministicOutcomes: 0,
          budgetErrors: 0,
          outcomeDistribution: {},
          slowObservationThresholdMs: SLOW_OBSERVATION_MS,
          slowObservations: 0,
          topSlowCases: [],
          findings: [{
            type: "watchdog-timeout",
            phase: watchdogPhase,
            timeoutMs: watchdogTimeoutMs,
            case: currentCase
          }]
        });
      }, timeoutMs);
    };

    armWatchdog("worker-startup", PROTOCOL_WATCHDOG_MS);
    child.on("message", (message) => {
      if (message?.kind === "case-start") {
        currentCase = message;
        armWatchdog("case", CASE_WATCHDOG_MS);
      } else if (message?.kind === "case-complete") {
        completedRuns = Number(message.run) + 1;
        armWatchdog("worker-protocol", PROTOCOL_WATCHDOG_MS);
      } else if (message?.kind === "report" && !settled) {
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(message.report);
      }
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolve({
        schemaVersion: 2,
        suite: "html-parser-fuzz",
        timestamp: new Date().toISOString(),
        runs: RUNS,
        completedRuns,
        seed: `0x${SEED.toString(16)}`,
        crashes: 1,
        hangs: 0,
        nondeterministicOutcomes: 0,
        budgetErrors: 0,
        outcomeDistribution: {},
        slowObservationThresholdMs: SLOW_OBSERVATION_MS,
        slowObservations: 0,
        topSlowCases: [],
        findings: [{ type: "worker-exit", code, signal, case: currentCase }]
      });
    });
  });
}

if (process.argv.includes("--worker")) {
  process.send?.({ kind: "report", report: runCampaign() });
} else if (process.argv.includes("--stall-worker")) {
  process.send?.({ kind: "case-start", id: "watchdog-probe", run: 0, seed: "probe" });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
} else if (process.argv.includes("--probe-watchdog")) {
  const report = await runCampaignWithWatchdog(["--stall-worker"]);
  const passed = report.hangs === 1 && report.crashes === 0 &&
    report.findings?.[0]?.type === "watchdog-timeout" &&
    report.findings?.[0]?.case?.id === "watchdog-probe";
  console.log(JSON.stringify({ passed, report }));
  if (!passed) process.exitCode = 1;
} else {
  const report = await runCampaignWithWatchdog();
  await writeJson("reports/fuzz.json", report);
  const failed = report.crashes > 0 || report.hangs > 0 || report.nondeterministicOutcomes > 0;
  if (failed) {
    console.error(
      `Fuzz qualification failed: crashes=${report.crashes}, hangs=${report.hangs}, `
        + `nondeterministic=${report.nondeterministicOutcomes}`
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Fuzz complete: runs=${report.runs}, crashes=0, hangs=0, `
        + `budgetErrors=${report.budgetErrors}, slowObservations=${report.slowObservations}`
    );
  }
}
