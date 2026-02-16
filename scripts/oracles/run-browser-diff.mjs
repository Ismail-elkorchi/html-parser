import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, firefox, webkit } from "playwright";

import { parse } from "../../dist/mod.js";
import { readJson, safeDiv, writeJson } from "../eval/eval-primitives.mjs";

const SEED = 0x5f3759df;
const RANDOM_CASES = 64;
const CURATED_CORPUS_PATH = new URL("./corpus/curated-v3.json", import.meta.url);
const REQUIRED_TAGS_DEFAULT = [
  "tokenizer/entities",
  "adoption-agency",
  "tables/foster-parenting",
  "foreign-content (svg/mathml)",
  "templates",
  "optional-tags",
  "comments/doctype",
  "scripting-flag surface (document.write-like markup patterns as strings only)"
];

if (process.platform === "linux" && process.env["PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS"] === undefined) {
  process.env["PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS"] = "1";
}

function nextSeed(seed) {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function randomCorpus(seed, size) {
  let state = seed >>> 0;
  const generatedCases = [];
  const alphabet = "<>/=&'\" abcdefghijklmnopqrstuvwxyz0123456789";

  for (let index = 0; index < size; index += 1) {
    state = nextSeed(state);
    const length = 16 + (state % 48);
    let value = "";
    for (let offset = 0; offset < length; offset += 1) {
      state = nextSeed(state);
      value += alphabet[state % alphabet.length] ?? "x";
    }
    generatedCases.push(value);
  }

  return generatedCases;
}

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

function assertUniqueCaseIds(cases) {
  const seenCaseIds = new Set();
  for (const testCase of cases) {
    if (seenCaseIds.has(testCase.id)) {
      throw new Error(`Duplicate browser corpus case id: ${testCase.id}`);
    }
    seenCaseIds.add(testCase.id);
  }
}

async function loadCuratedCorpus() {
  const raw = JSON.parse(await readFile(CURATED_CORPUS_PATH, "utf8"));
  const name = typeof raw.name === "string" && raw.name.length > 0 ? raw.name : "curated-v3";
  const requiredTags = Array.isArray(raw.requiredTags) && raw.requiredTags.length > 0
    ? raw.requiredTags.filter((tag) => typeof tag === "string" && tag.length > 0)
    : REQUIRED_TAGS_DEFAULT;

  const cases = [];
  for (const corpusEntry of raw.cases ?? []) {
    if (corpusEntry === null || typeof corpusEntry !== "object") {
      continue;
    }

    const caseId = typeof corpusEntry.id === "string" && corpusEntry.id.length > 0 ? corpusEntry.id : "";
    const input = typeof corpusEntry.html === "string" ? corpusEntry.html : "";
    const tags = Array.isArray(corpusEntry.tags)
      ? corpusEntry.tags.filter((tag) => typeof tag === "string" && tag.length > 0)
      : [];

    if (caseId.length === 0 || input.length === 0 || tags.length === 0) {
      continue;
    }

    cases.push({
      id: caseId,
      input,
      tags
    });
  }

  assertUniqueCaseIds(cases);
  return { name, requiredTags, cases };
}

async function loadThresholdPolicy() {
  const config = await readJson("evaluation.config.json");
  const browser = config.thresholds?.browserDiff || {};
  const requiredTags = Array.isArray(browser.requiredTags) && browser.requiredTags.length > 0
    ? browser.requiredTags.filter((tag) => typeof tag === "string" && tag.length > 0)
    : REQUIRED_TAGS_DEFAULT;

  return {
    minAgreement: Number(browser.minAgreement ?? 0.995),
    minEnginesPresent: Number(browser.minEnginesPresent ?? 1),
    minCases: Number(browser.minCases ?? 1),
    minTagCoverage: Number(browser.minTagCoverage ?? 0),
    requiredTags,
    agreementAggregation: config.scoring?.browserAgreementAggregation === "average" ? "average" : "min"
  };
}

function buildTagCounts(requiredTags, curatedCases) {
  const counts = Object.fromEntries(requiredTags.map((tag) => [tag, 0]));
  for (const testCase of curatedCases) {
    for (const tag of testCase.tags) {
      counts[tag] = Number(counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

async function writeDisagreementRecord(caseId, engineName, inputHtml, localNormalizedJson, browserNormalizedJson) {
  const safeCase = caseId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeEngine = engineName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join("reports", "triage", "browser-diff", safeEngine, `${safeCase}.md`);
  await mkdir(path.dirname(filePath), { recursive: true });

  const lines = [
    "# Browser differential disagreement",
    "",
    `Engine: ${engineName}`,
    `Case: ${caseId}`,
    "",
    "## Input",
    "```html",
    inputHtml,
    "```",
    "",
    "## Local normalization",
    "```json",
    localNormalizedJson,
    "```",
    "",
    "## Browser normalization",
    "```json",
    browserNormalizedJson,
    "```"
  ];

  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath.replaceAll(path.sep, "/");
}

async function normalizeInBrowser(page, htmlInput) {
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
  }, htmlInput);
}

async function runEngine(engineName, launcher, testCases) {
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

  for (const testCase of testCases) {
    const { id: caseId, input: inputHtml, localJson: localNormalizedJson } = testCase;
    let browserNormalizedJson;
    try {
      browserNormalizedJson = JSON.stringify(await normalizeInBrowser(page, inputHtml));
    } catch (error) {
      browserNormalizedJson = JSON.stringify(["error", error instanceof Error ? error.message : String(error)]);
    }

    compared += 1;
    if (localNormalizedJson === browserNormalizedJson) {
      agreed += 1;
      continue;
    }

    const triageRecord = await writeDisagreementRecord(
      caseId,
      engineName,
      inputHtml,
      localNormalizedJson,
      browserNormalizedJson
    );
    disagreements.push({
      id: caseId,
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

const thresholdPolicy = await loadThresholdPolicy();
const curatedCorpus = await loadCuratedCorpus();
const randomCases = randomCorpus(SEED, RANDOM_CASES).map((input, index) => ({
  id: `random-${String(index + 1).padStart(4, "0")}`,
  input,
  tags: []
}));
const allCorpusCases = [...curatedCorpus.cases, ...randomCases];
assertUniqueCaseIds(allCorpusCases);

const cases = allCorpusCases.map((testCase) => ({
  ...testCase,
  localJson: JSON.stringify(normalizeLibrary(testCase.input))
}));

const tagCounts = buildTagCounts(thresholdPolicy.requiredTags, curatedCorpus.cases);
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
  const engineRunResult = await runEngine(engineName, launcher, cases);
  engines[engineName] = engineRunResult.stats;
  disagreements.push(...engineRunResult.disagreements);
}

const report = {
  suite: "browser-diff",
  timestamp: new Date().toISOString(),
  corpus: {
    name: curatedCorpus.name,
    totalCases: allCorpusCases.length,
    curatedCases: curatedCorpus.cases.length,
    randomCases: randomCases.length,
    seed: `0x${SEED.toString(16)}`
  },
  coverage: {
    tagCounts,
    minPerTag: thresholdPolicy.minTagCoverage
  },
  engines,
  disagreements
};

await writeJson("reports/browser-diff.json", report);

const presentEngines = Object.keys(engines).filter((engineName) => Number(engines[engineName]?.compared || 0) > 0);
const agreementRatios = presentEngines.map((engineName) =>
  safeDiv(Number(engines[engineName]?.agreed || 0), Number(engines[engineName]?.compared || 0))
);
const aggregateAgreement = thresholdPolicy.agreementAggregation === "min"
  ? (agreementRatios.length > 0 ? Math.min(...agreementRatios) : 0)
  : (agreementRatios.length > 0
    ? agreementRatios.reduce((sum, value) => sum + value, 0) / agreementRatios.length
    : 0);

const lowCoverageTags = thresholdPolicy.requiredTags.filter(
  (tag) => Number(tagCounts[tag] ?? 0) < thresholdPolicy.minTagCoverage
);

const failures = [];
if (allCorpusCases.length < thresholdPolicy.minCases) {
  failures.push(`minCases not met: ${allCorpusCases.length}/${thresholdPolicy.minCases}`);
}
if (presentEngines.length < thresholdPolicy.minEnginesPresent) {
  failures.push(`minEnginesPresent not met: ${presentEngines.length}/${thresholdPolicy.minEnginesPresent}`);
}
if (aggregateAgreement < thresholdPolicy.minAgreement) {
  failures.push(`minAgreement not met: ${aggregateAgreement.toFixed(6)}/${thresholdPolicy.minAgreement}`);
}
if (lowCoverageTags.length > 0) {
  failures.push(`minTagCoverage not met for: ${lowCoverageTags.join(", ")}`);
}

if (failures.length > 0) {
  console.error(`Browser differential thresholds failed: ${failures.join("; ")}`);
  process.exit(1);
}

console.log(
  `Browser differential complete: cases=${allCorpusCases.length}, disagreements=${disagreements.length}, `
    + `agreement=${aggregateAgreement.toFixed(6)}`
);
