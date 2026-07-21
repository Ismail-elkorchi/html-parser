import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { chromium, firefox, webkit } from "playwright";

import { parse } from "../../dist/mod.js";
import { parseTreeDatFixtures } from "../../test/support/tree-dat.mjs";
import { verifyWptTreeCorpus } from "../../test/support/wpt-tree-corpus.mjs";
import { writeJson } from "../lib/report.mjs";

const BASELINE_PATH = "test/fixtures/qualification/document-browser-baseline.json";

const SUPPLEMENTAL_CASES = Object.freeze([
  { id: "entities", html: "<p title='&notit;'>&amp;&#x1f600;&notin;</p>" },
  { id: "optional-tags", html: "<ul><li>a<li>b</ul><p>x<p>y" },
  { id: "comment-and-doctype", html: "<!doctype html><!--a--><p>b" },
  { id: "reconstruction-after-block", html: "<p><b>one<div>two</b>three" },
  { id: "misnested-link", html: "<a><p></a></p>" },
  { id: "nested-formatting-adoption", html: "<b>1<i>2<p>3</b>4" },
  { id: "noah-family-cap", html: "<p><b><b><b><b><p>x" },
  { id: "nobr-recovery", html: "<!doctype html><nobr><nobr></nobr><nobr>" },
  { id: "ruby-implied-ends", html: "<html><ruby>a<rtc>b<rt>c<rb>d</ruby></html>" },
  { id: "form-pointer-removal", html: "<!doctype html><form><div></form><div>" },
  { id: "formatting-across-plaintext", html: "<!doctype html><p><a><plaintext>b" },
  { id: "foster-parented-text", html: "<!doctype html><p>lead<table>x<tr><td>cell</table>tail" },
  { id: "quirks-table-paragraph", html: "<p><table></p>" },
  { id: "synthesized-table-containers", html: "<!doctype html><table><td>a<td>b" },
  { id: "cell-end-tag-recovery", html: "<!doctype html><table><template><td></tr><div></template></table>" },
  { id: "template-table", html: "<!doctype html><template><table><tr><td>x</template><p>y" },
  { id: "template-column-group", html: "<!doctype html><template><col>Hello</template>" },
  { id: "template-body-attributes", html: "<!doctype html><body data=kept><template><body data=ignored></template>" },
  { id: "relaxed-select", html: "<!doctype html><select><div>x<option>a<select><option>b" },
  { id: "selectedcontent-option-clone", html: "<!doctype html><select><button><selectedcontent></button><option>X<option selected><b>Y</b>" },
  { id: "table-select", html: "<!doctype html><table><select><option>a</select></table>" },
  { id: "frameset", html: "<!doctype html><frameset cols=*><frame src=x></frameset></html>" },
  { id: "svg-adjustments", html: "<!doctype html><svg viewbox='0 0 1 1'><lineargradient xlink:href='#x'/></svg>" },
  { id: "foreign-integration-points", html: "<!doctype html><svg><foreignObject><p>x</p></foreignObject></svg><math><mi><b>y</b></mi></math>" },
  { id: "foreign-breakout", html: "<!doctype html><svg><g><table><tr><td>x</table>" },
  { id: "foreign-cdata", html: "<!doctype html><svg><g><![CDATA[x<y]]></g></svg>" }
]);

const AVAILABLE_ENGINES = Object.freeze({ chromium, firefox, webkit });
const requestedEngines = (process.env["HTML_PARSER_BROWSER_ENGINES"] ?? "chromium,firefox,webkit")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);
const engines = requestedEngines.map((name) => {
  const launcher = AVAILABLE_ENGINES[name];
  if (launcher === undefined) throw new Error(`Unsupported browser engine: ${name}`);
  return [name, launcher];
});

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeAttributes(attributes) {
  return attributes
    .map((attribute) => [attribute.namespaceUri, attribute.localName, attribute.value])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function normalizePublicNode(node) {
  if (node.kind === "text" || node.kind === "comment") return [node.kind, node.value];
  if (node.kind === "processingInstruction") {
    return ["processing-instruction", node.target, node.data];
  }
  if (node.kind === "doctype") {
    if (node.externalId.kind === "none") return ["doctype", node.name, "", ""];
    if (node.externalId.kind === "system") {
      return ["doctype", node.name, "", node.externalId.systemId];
    }
    return ["doctype", node.name, node.externalId.publicId, node.externalId.systemId ?? ""];
  }
  if (node.kind === "templateContent") return node.children.map(normalizePublicNode);
  return [
    "element",
    node.namespaceUri,
    node.localName,
    normalizeAttributes(node.attributes),
    (node.templateContent?.children ?? node.children).map(normalizePublicNode)
  ];
}

async function wptDocumentCases(corpus) {
  const cases = [];
  for (const relativePath of corpus.fixtureFiles) {
    const filePath = path.join(corpus.corpusRoot, relativePath);
    const fixtureIdPath = path.relative(corpus.repositoryRoot, filePath).split(path.sep).join("/");
    const fixtures = parseTreeDatFixtures(await readFile(filePath, "utf8"), fixtureIdPath);
    for (const fixture of fixtures) {
      if (fixture.fragmentContext === null && fixture.scripting === "both") {
        cases.push(Object.freeze({ id: `wpt:${fixture.id}`, html: fixture.data }));
      }
    }
  }
  return cases;
}

async function normalizeBrowserBatch(page, batch) {
  return page.evaluate((inputs) => inputs.map(({ id, html }) => {
    const document = new globalThis.DOMParser().parseFromString(html, "text/html");
    const normalize = (node) => {
      if (node.nodeType === globalThis.Node.TEXT_NODE) return ["text", node.nodeValue ?? ""];
      if (node.nodeType === globalThis.Node.COMMENT_NODE) return ["comment", node.nodeValue ?? ""];
      if (node.nodeType === globalThis.Node.PROCESSING_INSTRUCTION_NODE) {
        return ["processing-instruction", node.nodeName, node.nodeValue ?? ""];
      }
      if (node.nodeType === globalThis.Node.DOCUMENT_TYPE_NODE) {
        return ["doctype", node.name ?? "", node.publicId ?? "", node.systemId ?? ""];
      }
      if (node.nodeType !== globalThis.Node.ELEMENT_NODE) return ["other", node.nodeType];
      const attributes = Array.from(node.attributes)
        .map((attribute) => [attribute.namespaceURI, attribute.localName, attribute.value])
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      const parent = node.namespaceURI === "http://www.w3.org/1999/xhtml" &&
          node.localName === "template" && node.content !== undefined
        ? node.content
        : node;
      return [
        "element",
        node.namespaceURI,
        node.localName,
        attributes,
        Array.from(parent.childNodes).map(normalize)
      ];
    };
    return { id, tree: Array.from(document.childNodes).map(normalize) };
  }), batch);
}

const corpus = await verifyWptTreeCorpus();
const wptCases = await wptDocumentCases(corpus);
const cases = [
  ...wptCases,
  ...SUPPLEMENTAL_CASES.map((entry) => ({ ...entry, id: `supplemental:${entry.id}` }))
];
const publicCases = cases.map((testCase) => {
  const tree = parse(testCase.html).tree.children.map(normalizePublicNode);
  return { ...testCase, publicTree: tree, publicSha256: sha256(tree) };
});
const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
if (baseline.schemaVersion !== 1 ||
    baseline.corpusCommit !== corpus.manifest.commit ||
    baseline.corpusCompositeSha256 !== corpus.compositeSha256 ||
    baseline.cases?.total !== cases.length ||
    baseline.cases?.wptScriptingInvariant !== wptCases.length ||
    baseline.cases?.supplemental !== SUPPLEMENTAL_CASES.length ||
    typeof baseline.engines !== "object" || baseline.engines === null) {
  throw new Error("Document browser baseline does not match the pinned qualification inputs");
}

const results = [];
for (const [name, launcher] of engines) {
  let browser;
  try {
    browser = await launcher.launch({ headless: true });
    const page = await browser.newPage();
    const browserTrees = new Map();
    for (let start = 0; start < cases.length; start += 100) {
      const batch = cases.slice(start, start + 100).map(({ id, html }) => ({ id, html }));
      for (const outcome of await normalizeBrowserBatch(page, batch)) {
        browserTrees.set(outcome.id, outcome.tree);
      }
    }
    const failures = [];
    const outcomes = [];
    for (const testCase of publicCases) {
      const browserTree = browserTrees.get(testCase.id);
      if (browserTree === undefined) throw new Error(`Missing browser result for ${testCase.id}`);
      const browserSha256 = sha256(browserTree);
      outcomes.push([testCase.id, testCase.publicSha256, browserSha256]);
      if (testCase.publicSha256 === browserSha256) continue;
      const difference = {
        id: testCase.id,
        publicSha256: testCase.publicSha256,
        browserSha256
      };
      failures.push({ ...difference, publicTree: testCase.publicTree, browserTree });
    }
    const outcomeSha256 = sha256(outcomes);
    const differenceRecords = failures.map(({ id, publicSha256, browserSha256 }) => ({
      id, publicSha256, browserSha256
    }));
    const differenceSha256 = sha256(differenceRecords);
    const version = browser.version();
    const expected = baseline.engines[name];
    const baselineMismatches = [];
    if (expected === undefined) baselineMismatches.push("engine-not-baselined");
    else {
      if (expected.version !== version) baselineMismatches.push("browser-version");
      if (expected.outcomesSha256 !== outcomeSha256) baselineMismatches.push("all-outcomes");
      if (expected.differenceCount !== failures.length) baselineMismatches.push("difference-count");
      if (expected.differencesSha256 !== differenceSha256) {
        baselineMismatches.push("difference-inventory");
      }
    }
    const baselineMatches = baselineMismatches.length === 0;
    results.push({
      name,
      version,
      status: baselineMatches ? "pass" : "fail",
      cases: cases.length,
      outcomesSha256: outcomeSha256,
      knownDifferences: {
        count: failures.length,
        sha256: differenceSha256,
        reason: baseline.reason
      },
      baselineMismatches,
      failures: baselineMatches ? [] : failures
    });
  } catch (error) {
    results.push({
      name,
      status: "unavailable",
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    });
  } finally {
    await browser?.close();
  }
}

const report = {
  schemaVersion: 1,
  suite: "html-parser-document-browser-differential",
  generatedAt: new Date().toISOString(),
  corpusCommit: corpus.manifest.commit,
  corpusCompositeSha256: corpus.compositeSha256,
  cases: {
    total: cases.length,
    wptScriptingInvariant: wptCases.length,
    supplemental: SUPPLEMENTAL_CASES.length
  },
  results
};
await writeJson("reports/document-browser-diff.json", report);
console.log(JSON.stringify(report));
if (results.some((result) => result.status !== "pass")) process.exitCode = 1;
