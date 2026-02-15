import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, firefox, webkit } from "playwright";

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

  for (let index = 0; index < size; index += 1) {
    state = nextSeed(state);
    const length = 16 + (state % 48);
    let value = "";
    for (let offset = 0; offset < length; offset += 1) {
      state = nextSeed(state);
      value += alphabet[state % alphabet.length] ?? "x";
    }
    out.push(value);
  }

  return out;
}

const curated = [
  "<!doctype html><html><body><h1>a</h1></body></html>",
  "<div class='x' data-a=1>z</div>",
  "<svg><foreignObject><p>q</p></foreignObject></svg>",
  "<math><mi>x</mi><mo>+</mo><mi>y</mi></math>",
  "<template><p>inside</p></template>",
  "<table><tr><td>x</td></tr></table>"
];

function normalizeAttributes(attributes) {
  return [...attributes]
    .map((attribute) => [attribute.name, attribute.value])
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      if (leftName !== rightName) {
        return leftName.localeCompare(rightName);
      }
      return leftValue.localeCompare(rightValue);
    });
}

function normalizeLibraryNode(node) {
  if (node.kind === "text") {
    return ["text", node.value];
  }

  if (node.kind === "comment") {
    return ["comment", node.value];
  }

  if (node.kind === "doctype") {
    return ["doctype", node.name, node.publicId ?? "", node.systemId ?? ""];
  }

  const children = node.children.map((child) => normalizeLibraryNode(child));
  const attributes = normalizeAttributes(node.attributes);
  return ["element", node.tagName.toLowerCase(), attributes, children];
}

function normalizeLibrary(html) {
  const tree = parse(html);
  return tree.children.map((child) => normalizeLibraryNode(child));
}

async function writeDisagreementRecord(caseId, engine, input, local, browser) {
  const safeCase = caseId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeEngine = engine.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join("reports", "triage", "browser-diff", safeEngine, `${safeCase}.md`);
  await mkdir(path.dirname(filePath), { recursive: true });

  const lines = [
    "# Browser differential disagreement",
    "",
    `Engine: ${engine}`,
    `Case: ${caseId}`,
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
    "```json",
    browser,
    "```"
  ];

  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath.replaceAll(path.sep, "/");
}

async function normalizeInBrowser(page, html) {
  return page.evaluate((input) => {
    const parser = new globalThis.DOMParser();
    const document = parser.parseFromString(input, "text/html");
    const nodeTypes = globalThis.Node;

    const normalizeAttributesInPage = (element) =>
      Array.from(element.attributes)
        .map((attribute) => [attribute.name, attribute.value])
        .sort(([leftName, leftValue], [rightName, rightValue]) => {
          if (leftName !== rightName) {
            return leftName.localeCompare(rightName);
          }
          return leftValue.localeCompare(rightValue);
        });

    const normalizeNode = (node) => {
      if (node.nodeType === nodeTypes.TEXT_NODE) {
        return ["text", node.nodeValue ?? ""];
      }

      if (node.nodeType === nodeTypes.COMMENT_NODE) {
        return ["comment", node.nodeValue ?? ""];
      }

      if (node.nodeType === nodeTypes.DOCUMENT_TYPE_NODE) {
        return [
          "doctype",
          node.name ?? "",
          node.publicId ?? "",
          node.systemId ?? ""
        ];
      }

      if (node.nodeType === nodeTypes.ELEMENT_NODE) {
        const tag = (node.localName ?? node.nodeName ?? "").toLowerCase();
        const attributes = normalizeAttributesInPage(node);
        const children = Array.from(node.childNodes).map((child) => normalizeNode(child));
        return ["element", tag, attributes, children];
      }

      return ["other", node.nodeType];
    };

    return Array.from(document.childNodes).map((node) => normalizeNode(node));
  }, html);
}

async function runEngine(engineName, launcher, cases) {
  const disagreements = [];
  let compared = 0;
  let agreed = 0;

  let browser;
  try {
    browser = await launcher.launch({ headless: true });
  } catch (error) {
    return {
      stats: {
        compared: 0,
        agreed: 0,
        disagreed: 0,
        error: error instanceof Error ? error.message : String(error)
      },
      disagreements
    };
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const userAgent = await page.evaluate(() => globalThis.navigator.userAgent);
  const version = browser.version();

  for (const testCase of cases) {
    const { id, input, localJson } = testCase;
    let browserJson;
    try {
      browserJson = JSON.stringify(await normalizeInBrowser(page, input));
    } catch (error) {
      browserJson = JSON.stringify(["error", error instanceof Error ? error.message : String(error)]);
    }

    compared += 1;
    if (localJson === browserJson) {
      agreed += 1;
      continue;
    }

    const triageRecord = await writeDisagreementRecord(id, engineName, input, localJson, browserJson);
    disagreements.push({
      id,
      engine: engineName,
      triageRecord
    });
  }

  await context.close();
  await browser.close();

  return {
    stats: {
      compared,
      agreed,
      disagreed: compared - agreed,
      version,
      userAgent
    },
    disagreements
  };
}

const corpus = [...curated, ...randomCorpus(SEED, RANDOM_CASES)];
const cases = corpus.map((input, index) => ({
  id: `case-${String(index + 1).padStart(4, "0")}`,
  input,
  localJson: JSON.stringify(normalizeLibrary(input))
}));

const engines = {
  chromium: { compared: 0, agreed: 0, disagreed: 0 },
  firefox: { compared: 0, agreed: 0, disagreed: 0 },
  webkit: { compared: 0, agreed: 0, disagreed: 0 }
};

const disagreements = [];
for (const [engineName, launcher] of [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit]
]) {
  const result = await runEngine(engineName, launcher, cases);
  engines[engineName] = result.stats;
  disagreements.push(...result.disagreements);
}

await writeJson("reports/browser-diff.json", {
  suite: "browser-diff",
  timestamp: new Date().toISOString(),
  corpus: {
    name: "curated-v2",
    seed: `0x${SEED.toString(16)}`,
    cases: corpus.length
  },
  engines,
  disagreements
});

const summary = Object.entries(engines)
  .map(([name, data]) => `${name}:${String(data.agreed)}/${String(data.compared)}`)
  .join(" ");
console.log(`Browser diff complete: ${summary}`);
