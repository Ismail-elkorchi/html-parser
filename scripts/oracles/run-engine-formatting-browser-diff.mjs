import { chromium, firefox, webkit } from "playwright";

import { runHtmlEngine } from "../../dist/internal/html-engine/mod.js";

if (
  process.platform === "linux" &&
  process.env["PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS"] === undefined
) {
  process.env["PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS"] = "1";
}

const CASES = Object.freeze([
  { id: "reconstruction-after-block", html: "<p><b>one<div>two</b>three" },
  { id: "misnested-link", html: "<a><p></a></p>" },
  { id: "nested-formatting-adoption", html: "<b>1<i>2<p>3</b>4" },
  { id: "noah-family-cap", html: "<p><b><b><b><b><p>x" },
  { id: "nobr-recovery", html: "<!doctype html><nobr><nobr></nobr><nobr>" },
  { id: "ruby-implied-ends", html: "<html><ruby>a<rtc>b<rt>c<rb>d</ruby></html>" },
  { id: "form-pointer-removal", html: "<!doctype html><form><div></form><div>" },
  { id: "formatting-across-plaintext", html: "<!doctype html><p><a><plaintext>b" }
]);

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
      const children = Array.from(node.childNodes).map(normalize);
      return ["element", node.namespaceURI, node.localName, attributes, children];
    };
    return Array.from(document.childNodes).map(normalize);
  }, html);
}

const engines = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit]
];
const results = [];
for (const [name, launcher] of engines) {
  let browser;
  try {
    browser = await launcher.launch({ headless: true });
  } catch (error) {
    results.push({ name, status: "unavailable", reason: error instanceof Error ? error.message : String(error) });
    continue;
  }
  try {
    const page = await browser.newPage();
    const disagreements = [];
    for (const testCase of CASES) {
      const actual = normalizeEngine(testCase.html);
      const expected = await normalizeBrowser(page, testCase.html);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) disagreements.push(testCase.id);
    }
    results.push({ name, status: disagreements.length === 0 ? "pass" : "fail", disagreements });
  } finally {
    await browser.close();
  }
}

const available = results.filter((result) => result.status !== "unavailable");
console.log(JSON.stringify({ schema: "engine-formatting-browser-diff/v1", cases: CASES.length, results }));
if (available.length === 0 || available.some((result) => result.status === "fail")) process.exitCode = 1;
