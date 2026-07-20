import { createHash } from "node:crypto";

import { chromium, firefox, webkit } from "playwright";

import { runHtmlEngine } from "../../dist/internal/html-engine/mod.js";

function normalizeAttributes(element) {
  const attributes = [];
  for (let index = 0; index < element.attributeCount; index += 1) {
    const attribute = element.attributeAt(index);
    if (attribute !== null) attributes.push([attribute.namespaceUri, attribute.localName, attribute.value]);
  }
  attributes.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return attributes;
}

function normalizeEngineNode(node) {
  if (node.kind === "text" || node.kind === "comment") return [node.kind, node.data];
  if (node.kind === "doctype") {
    if (node.externalId.kind === "none") return ["doctype", node.name, "", ""];
    if (node.externalId.kind === "system") {
      return ["doctype", node.name, "", node.externalId.systemIdentifier];
    }
    return [
      "doctype",
      node.name,
      node.externalId.publicIdentifier,
      node.externalId.systemIdentifier ?? ""
    ];
  }
  if (node.kind === "processing-instruction") return ["processing-instruction", node.target, node.data];
  const children = [];
  const parent = node.templateContents ?? node;
  for (let index = 0; index < parent.childCount; index += 1) {
    const child = parent.childAt(index);
    if (child !== null) children.push(normalizeEngineNode(child));
  }
  return ["element", node.namespaceUri, node.localName, normalizeAttributes(node), children];
}

function normalizeEngine(html) {
  const result = runHtmlEngine({
    inputChunks: [html],
    parser: { kind: "document", scriptingMode: "inert" }
  });
  const nodes = [];
  for (let index = 0; index < result.model.root.childCount; index += 1) {
    const node = result.model.root.childAt(index);
    if (node !== null) nodes.push(normalizeEngineNode(node));
  }
  return nodes;
}

async function normalizeBrowser(page, html) {
  return page.evaluate((input) => {
    const document = new globalThis.DOMParser().parseFromString(input, "text/html");
    const normalize = (node) => {
      if (node.nodeType === globalThis.Node.TEXT_NODE) return ["text", node.nodeValue ?? ""];
      if (node.nodeType === globalThis.Node.COMMENT_NODE) return ["comment", node.nodeValue ?? ""];
      if (node.nodeType === globalThis.Node.DOCUMENT_TYPE_NODE) {
        return ["doctype", node.name ?? "", node.publicId ?? "", node.systemId ?? ""];
      }
      if (node.nodeType !== globalThis.Node.ELEMENT_NODE) return ["other", node.nodeType];
      const attributes = Array.from(node.attributes)
        .map((attribute) => [attribute.namespaceURI, attribute.localName, attribute.value])
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      const parent = node.localName === "template" ? node.content : node;
      const children = Array.from(parent.childNodes).map(normalize);
      return ["element", node.namespaceURI, node.localName, attributes, children];
    };
    return Array.from(document.childNodes).map(normalize);
  }, html);
}

const ENGINES = Object.freeze([
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit]
]);

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function runBrowserTreeDifferential({ schema, cases }) {
  if (
    process.platform === "linux" &&
    process.env["PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS"] === undefined
  ) {
    process.env["PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS"] = "1";
  }

  const results = [];
  for (const [name, launcher] of ENGINES) {
    let browser;
    try {
      browser = await launcher.launch({ headless: true });
    } catch (error) {
      results.push({
        name,
        status: "unavailable",
        reason: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    try {
      const page = await browser.newPage();
      const disagreements = [];
      const acceptedDisagreements = [];
      for (const testCase of cases) {
        const actual = normalizeEngine(testCase.html);
        const expected = await normalizeBrowser(page, testCase.html);
        if (JSON.stringify(actual) === JSON.stringify(expected)) continue;
        const disagreement = {
          id: testCase.id,
          engineSha256: sha256(actual),
          browserSha256: sha256(expected)
        };
        const accepted = testCase.acceptedBrowserTrees?.[name];
        if (
          accepted?.engineSha256 === disagreement.engineSha256 &&
          accepted.browserSha256 === disagreement.browserSha256
        ) {
          acceptedDisagreements.push({ ...disagreement, reason: accepted.reason });
        } else {
          disagreements.push(disagreement);
        }
      }
      results.push({
        name,
        version: browser.version(),
        status: disagreements.length === 0 ? "pass" : "fail",
        disagreements,
        acceptedDisagreements
      });
    } finally {
      await browser.close();
    }
  }

  const available = results.filter((result) => result.status !== "unavailable");
  console.log(JSON.stringify({ schema, cases: cases.length, results }));
  if (available.length === 0 || available.some((result) => result.status === "fail")) {
    process.exitCode = 1;
  }
}
