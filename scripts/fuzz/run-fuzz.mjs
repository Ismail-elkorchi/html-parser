import { performance } from "node:perf_hooks";

import { BudgetExceededError, parse } from "../../dist/mod.js";
import { writeJson } from "../eval/eval-primitives.mjs";

const RUNS = 600;
const SEED = 0x9e3779b9;
const HANG_THRESHOLD_MS = 25;
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
      trace: true,
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
    trace: true,
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

let crashes = 0;
let hangs = 0;
let budgetErrors = 0;
let normalParses = 0;
const findings = [];
const slowCases = [];
let state = SEED;

for (let run = 0; run < RUNS; run += 1) {
  state = nextSeed(state);
  const caseSeed = state;
  const budgetProfile = run % 4 === 0 ? "tight" : "default";
  const html = generateStructuredHtml(caseSeed, run);
  const caseId = `fuzz-${String(run + 1).padStart(4, "0")}`;

  const started = performance.now();
  let outcome = "normal";

  try {
    const first = parseWithProfile(html, budgetProfile);
    const second = parseWithProfile(html, budgetProfile);
    normalParses += 1;

    if (JSON.stringify(first) !== JSON.stringify(second)) {
      findings.push({
        id: caseId,
        seed: `0x${caseSeed.toString(16)}`,
        type: "nondeterministic",
        budgetProfile,
        inputPreview: html.slice(0, 220)
      });
    }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
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
  if (elapsed > HANG_THRESHOLD_MS) {
    hangs += 1;
    findings.push({
      id: caseId,
      seed: `0x${caseSeed.toString(16)}`,
      type: "slow-case",
      budgetProfile,
      elapsedMs: Number(elapsed.toFixed(3))
    });
  }

  slowCases.push({
    id: caseId,
    seed: `0x${caseSeed.toString(16)}`,
    budgetProfile,
    elapsedMs: Number(elapsed.toFixed(3)),
    outcome
  });
}

slowCases.sort((left, right) => right.elapsedMs - left.elapsedMs || left.id.localeCompare(right.id));
const topSlowCases = slowCases.slice(0, TOP_SLOWEST);

await writeJson("reports/fuzz.json", {
  suite: "fuzz",
  timestamp: new Date().toISOString(),
  runs: RUNS,
  seed: `0x${SEED.toString(16)}`,
  crashes,
  hangs,
  budgetErrors,
  outcomeDistribution: {
    normalParses,
    budgetErrors,
    crashes
  },
  topSlowCases,
  findings
});

if (crashes > 0) {
  console.error(`Fuzz crashes detected: ${crashes}`);
  process.exit(1);
}

console.log(
  `Fuzz complete: runs=${RUNS}, crashes=${crashes}, hangs=${hangs}, `
    + `budgetErrors=${budgetErrors}, normalParses=${normalParses}`
);
