import { createHash } from "node:crypto";

import { chromium, firefox, webkit } from "playwright";

import { parse } from "../../dist/mod.js";
import { writeJson } from "../lib/report.mjs";

const CASES = Object.freeze([
  {
    id: "entities",
    html: "<p title='&notit;'>&amp;&#x1f600;&notin;</p>",
    acceptedBrowserTrees: {
      chromium: {
        publicSha256: "63a15bef825528331a1919ea51f47b4ba4e323317ba63223ff8b6a7beb4e5894",
        browserSha256: "2340ee2fe185815809fca40512a6956b86013d7115a933b7924729bcf2b64263",
        reason: "Chromium 149 consumes the semicolonless not match before an ASCII letter in an attribute; the current named-character-reference algorithm requires the literal &notit; value"
      }
    }
  },
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
  {
    id: "relaxed-select",
    html: "<!doctype html><select><div>x<option>a<select><option>b",
    acceptedBrowserTrees: {
      firefox: {
        publicSha256: "e950f95225e1683318230ae941f94b4d2052282b4b8bed4cf4542ba4abfc88c3",
        browserSha256: "dc41b5a343e78d2bcb7644bcd63cf137b0b69500a9580e759c34383acfc78e6e",
        reason: "the bundled Firefox parser predates the relaxed-select tree-construction change"
      }
    }
  },
  {
    id: "selectedcontent-option-clone",
    html: "<!doctype html><select><button><selectedcontent></button><option>X<option selected><b>Y</b>",
    acceptedBrowserTrees: {
      firefox: {
        publicSha256: "b6cbe1f823ae2ceeaaed5c47c04b5e82cfe912796314fe7c9498592a87aa86bb",
        browserSha256: "9a072e51114310c7947704a9be9c137152021b7a9dfbb18c0b02c6003f7b6b53",
        reason: "the bundled Firefox parser predates selectedcontent parser construction"
      }
    }
  },
  { id: "table-select", html: "<!doctype html><table><select><option>a</select></table>" },
  { id: "frameset", html: "<!doctype html><frameset cols=*><frame src=x></frameset></html>" },
  { id: "svg-adjustments", html: "<!doctype html><svg viewbox='0 0 1 1'><lineargradient xlink:href='#x'/></svg>" },
  { id: "foreign-integration-points", html: "<!doctype html><svg><foreignObject><p>x</p></foreignObject></svg><math><mi><b>y</b></mi></math>" },
  { id: "foreign-breakout", html: "<!doctype html><svg><g><table><tr><td>x</table>" },
  { id: "foreign-cdata", html: "<!doctype html><svg><g><![CDATA[x<y]]></g></svg>" }
]);
const ENGINES = Object.freeze([
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit]
]);

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

function normalizePublic(html) {
  return parse(html).tree.children.map(normalizePublicNode);
}

async function normalizeBrowser(page, html) {
  return page.evaluate((input) => {
    const document = new globalThis.DOMParser().parseFromString(input, "text/html");
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
      const parent = node.localName === "template" ? node.content : node;
      return [
        "element",
        node.namespaceURI,
        node.localName,
        attributes,
        Array.from(parent.childNodes).map(normalize)
      ];
    };
    return Array.from(document.childNodes).map(normalize);
  }, html);
}

const results = [];
for (const [name, launcher] of ENGINES) {
  let browser;
  try {
    browser = await launcher.launch({ headless: true });
    const page = await browser.newPage();
    const failures = [];
    const acceptedDifferences = [];
    const outcomes = [];
    for (const testCase of CASES) {
      const publicTree = normalizePublic(testCase.html);
      const browserTree = await normalizeBrowser(page, testCase.html);
      outcomes.push({ id: testCase.id, publicTree, browserTree });
      if (JSON.stringify(publicTree) === JSON.stringify(browserTree)) continue;
      const difference = {
        id: testCase.id,
        publicSha256: sha256(publicTree),
        browserSha256: sha256(browserTree)
      };
      const accepted = testCase.acceptedBrowserTrees?.[name];
      if (accepted?.publicSha256 === difference.publicSha256 &&
          accepted.browserSha256 === difference.browserSha256) {
        acceptedDifferences.push({ ...difference, reason: accepted.reason });
      } else {
        failures.push({ ...difference, publicTree, browserTree });
      }
    }
    results.push({
      name,
      version: browser.version(),
      status: failures.length === 0 ? "pass" : "fail",
      cases: CASES.length,
      outcomesSha256: sha256(outcomes),
      acceptedDifferences,
      failures
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
  cases: CASES.length,
  results
};
await writeJson("reports/document-browser-diff.json", report);
console.log(JSON.stringify(report));
if (results.some((result) => result.status !== "pass")) process.exitCode = 1;
