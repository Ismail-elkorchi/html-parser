import { performance } from "node:perf_hooks";

import { BudgetExceededError, parse } from "../../dist/mod.js";
import { writeJson } from "../eval/util.mjs";

const RUNS = 600;
const SEED = 0x9e3779b9;
const HANG_THRESHOLD_MS = 25;

function nextSeed(seed) {
  return (Math.imul(seed, 1103515245) + 12345) >>> 0;
}

function generateHtml(seed) {
  let state = seed >>> 0;
  const tags = ["div", "span", "p", "a", "h1", "h2", "section", "article"];
  const atoms = ["alpha", "beta", "gamma", "delta", "x", "y", "z", "&amp;"];

  const nodeCount = 1 + (state % 8);
  const chunks = [];

  for (let i = 0; i < nodeCount; i += 1) {
    state = nextSeed(state);
    const tag = tags[state % tags.length] ?? "div";
    state = nextSeed(state);
    const atom = atoms[state % atoms.length] ?? "x";
    chunks.push(`<${tag} data-i="${i}">${atom}</${tag}>`);
  }

  return chunks.join("");
}

let crashes = 0;
let hangs = 0;
let budgetErrors = 0;
const findings = [];
let state = SEED;

for (let run = 0; run < RUNS; run += 1) {
  state = nextSeed(state);
  const html = generateHtml(state);

  const started = performance.now();
  try {
    const first = parse(html, {
      trace: true,
      budgets: {
        maxInputBytes: 4096,
        maxNodes: 64,
        maxDepth: 8,
        maxTraceEvents: 32,
        maxTraceBytes: 2048,
        maxTimeMs: 100
      }
    });
    const second = parse(html, {
      trace: true,
      budgets: {
        maxInputBytes: 4096,
        maxNodes: 64,
        maxDepth: 8,
        maxTraceEvents: 32,
        maxTraceBytes: 2048,
        maxTimeMs: 100
      }
    });

    if (JSON.stringify(first) !== JSON.stringify(second)) {
      findings.push({
        id: `fuzz-${String(run + 1).padStart(4, "0")}`,
        type: "nondeterministic",
        inputPreview: html.slice(0, 200)
      });
    }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      budgetErrors += 1;
    } else {
      crashes += 1;
      findings.push({
        id: `fuzz-${String(run + 1).padStart(4, "0")}`,
        type: "crash",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const elapsed = performance.now() - started;
  if (elapsed > HANG_THRESHOLD_MS) {
    hangs += 1;
    findings.push({
      id: `fuzz-${String(run + 1).padStart(4, "0")}`,
      type: "slow-case",
      elapsedMs: Number(elapsed.toFixed(3))
    });
  }
}

await writeJson("reports/fuzz.json", {
  suite: "fuzz",
  timestamp: new Date().toISOString(),
  runs: RUNS,
  seed: `0x${SEED.toString(16)}`,
  crashes,
  hangs,
  budgetErrors,
  findings
});

if (crashes > 0) {
  console.error(`Fuzz crashes detected: ${crashes}`);
  process.exit(1);
}

console.log(`Fuzz complete: runs=${RUNS}, crashes=${crashes}, hangs=${hangs}, budgetErrors=${budgetErrors}`);
