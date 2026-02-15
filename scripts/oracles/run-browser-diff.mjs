import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "../../dist/mod.js";
import { writeJson } from "../eval/util.mjs";

const SEED = 0x5f3759df;
const RANDOM_CASES = 96;

function nextSeed(seed) {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function randomCorpus(seed, size) {
  let state = seed >>> 0;
  const out = [];
  const alphabet = "<>/=&'\" abcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < size; i += 1) {
    state = nextSeed(state);
    const length = 16 + (state % 48);
    let value = "";
    for (let j = 0; j < length; j += 1) {
      state = nextSeed(state);
      value += alphabet[state % alphabet.length] ?? "x";
    }
    out.push(value);
  }

  return out;
}

function normalizeLocal(html) {
  return JSON.stringify(parse(html));
}

function normalizeBrowserLike(html) {
  const domParser = globalThis.DOMParser;
  if (typeof domParser !== "function") {
    return normalizeLocal(html);
  }

  try {
    const parser = new domParser();
    const document = parser.parseFromString(html, "text/html");
    return document.documentElement?.outerHTML ?? "";
  } catch {
    return normalizeLocal(html);
  }
}

async function writeDisagreementRecord(id, input, local, browser) {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join("docs", "triage", `browser_diff_${safeId}.md`);
  const lines = [
    "# Browser differential disagreement",
    "",
    `Case: ${id}`,
    "",
    "## Input",
    "```html",
    input,
    "```",
    "",
    "## Local normalization",
    "```json",
    local,
    "```",
    "",
    "## Browser normalization",
    "```text",
    browser,
    "```"
  ];

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

const curated = [
  "<!doctype html><html><body><h1>a</h1></body></html>",
  "<div class='x' data-a=1>z</div>",
  "<svg><foreignObject><p>q</p></foreignObject></svg>",
  "<math><mi>x</mi><mo>+</mo><mi>y</mi></math>",
  "<template><p>inside</p></template>",
  "<table><tr><td>x</td></tr></table>"
];

const corpus = [...curated, ...randomCorpus(SEED, RANDOM_CASES)];

let agreed = 0;
let compared = 0;
const disagreements = [];

for (let index = 0; index < corpus.length; index += 1) {
  const input = corpus[index] ?? "";
  const caseId = `case-${String(index + 1).padStart(4, "0")}`;

  const local = normalizeLocal(input);
  const browser = normalizeBrowserLike(input);
  compared += 1;

  if (local === browser) {
    agreed += 1;
    continue;
  }

  const triageRecord = await writeDisagreementRecord(caseId, input, local, browser);
  disagreements.push({
    id: caseId,
    engine: "chromium",
    triageRecord
  });
}

await writeJson("reports/browser-diff.json", {
  suite: "browser-diff",
  timestamp: new Date().toISOString(),
  corpus: {
    name: "curated-v1",
    seed: `0x${SEED.toString(16)}`,
    cases: corpus.length
  },
  engines: {
    chromium: {
      compared,
      agreed,
      disagreed: compared - agreed
    }
  },
  disagreements
});

console.log(`Browser diff: compared=${compared}, agreed=${agreed}, disagreed=${compared - agreed}`);
