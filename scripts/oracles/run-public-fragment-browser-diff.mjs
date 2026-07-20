import { createHash } from "node:crypto";

import { chromium, firefox, webkit } from "playwright";

import {
  HTML_NAMESPACE_URI,
  MATHML_NAMESPACE_URI,
  SVG_NAMESPACE_URI,
  parseFragment
} from "../../dist/mod.js";
import { writeJson } from "../eval/eval-primitives.mjs";

const context = (namespaceUri, localName, attributes = []) => Object.freeze({
  namespaceUri,
  localName,
  attributes: Object.freeze(attributes)
});

const CASES = Object.freeze([
  {
    id: "html-basic",
    html: "<b>x</b><p>y",
    context: context(HTML_NAMESPACE_URI, "div")
  },
  {
    id: "html-table",
    html: "<tr><td>A<td>B",
    context: context(HTML_NAMESPACE_URI, "tbody")
  },
  {
    id: "html-template",
    html: "<table><td>x</table><p>y",
    context: context(HTML_NAMESPACE_URI, "template")
  },
  {
    id: "html-rcdata",
    html: "a<b>&amp;</textarea>c",
    context: context(HTML_NAMESPACE_URI, "textarea")
  },
  {
    id: "svg-context",
    html: "<lineargradient/><foreignObject><p>y</p></foreignObject>",
    context: context(SVG_NAMESPACE_URI, "svg")
  },
  {
    id: "svg-integration-point",
    html: "<b>y</b><circle/>",
    context: context(SVG_NAMESPACE_URI, "title")
  },
  {
    id: "mathml-text-integration-point",
    html: "<b>x</b><mglyph/>",
    context: context(MATHML_NAMESPACE_URI, "mi")
  },
  {
    id: "mathml-annotation-html-integration-point",
    html: "<p>x</p><svg><circle/></svg>",
    context: context(MATHML_NAMESPACE_URI, "annotation-xml", [
      { namespaceUri: null, localName: "encoding", value: "text/html" }
    ]),
    acceptedBrowserTrees: {
      firefox: {
        publicSha256: "c4d540bde33519679ab2d289f1e76963c15e1ac3a4569c4e0a9c070567e15baa",
        browserSha256: "2c14e71105a44a9596b4f8a1ce46943132dcc28dca8bc02e78b62e1c823f0b30",
        reason: "Firefox 151 does not apply the annotation-xml encoding integration point for innerHTML on an external MathML context; the pinned WPT fragment result uses HTML namespace"
      }
    }
  },
  {
    id: "noscript-inert",
    html: "<b>x</b>",
    context: context(HTML_NAMESPACE_URI, "noscript"),
    options: { scriptingMode: "inert" }
  },
  {
    id: "noscript-disabled",
    html: "<b>x</b>",
    context: context(HTML_NAMESPACE_URI, "noscript"),
    options: { scriptingMode: "disabled" },
    acceptedBrowserTrees: {
      firefox: {
        publicSha256: "93065e7b315ac0326d953d9d7c7afd08bd099d6f31c5965e262870d6ab411746",
        browserSha256: "b1e7c02ceeb5a0e2cbd9bacf0f21216e52bd8330ab2c18efdafb3d694c84aede",
        reason: "Firefox 151 tokenizes innerHTML for a noscript context as raw text in a same-origin sandbox without allow-scripts; the pinned fragment algorithm selects Data when scripting is disabled"
      }
    }
  },
  {
    id: "quirks-owner-document",
    html: "<p>x<table><tr><td>y",
    context: context(HTML_NAMESPACE_URI, "div"),
    options: { documentMode: "quirks" }
  },
  {
    id: "limited-quirks-owner-document",
    html: "<p>x<table><tr><td>y",
    context: context(HTML_NAMESPACE_URI, "div"),
    options: { documentMode: "limited-quirks" }
  },
  {
    id: "form-in-context-chain",
    html: "<form><input>",
    context: context(HTML_NAMESPACE_URI, "div"),
    options: { hasFormInContextChain: true }
  },
  {
    id: "form-is-context",
    html: "<form><input>",
    context: context(HTML_NAMESPACE_URI, "form"),
    options: { hasFormInContextChain: true }
  }
]);

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizePublicNode(node) {
  if (node.kind === "text" || node.kind === "comment") return [node.kind, node.value];
  if (node.kind === "processingInstruction") return [node.kind, node.target, node.data];
  if (node.kind === "doctype") {
    if (node.externalId.kind === "none") return ["doctype", node.name, "", ""];
    if (node.externalId.kind === "system") {
      return ["doctype", node.name, "", node.externalId.systemId];
    }
    return ["doctype", node.name, node.externalId.publicId, node.externalId.systemId ?? ""];
  }
  if (node.kind === "templateContent") {
    return ["template-content", node.children.map(normalizePublicNode)];
  }
  const attributes = node.attributes
    .map((attribute) => [attribute.namespaceUri, attribute.localName, attribute.value])
    .sort((left, right) => {
      const leftKey = JSON.stringify(left);
      const rightKey = JSON.stringify(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  const children = (node.templateContent?.children ?? node.children).map(normalizePublicNode);
  return ["element", node.namespaceUri, node.localName, attributes, children];
}

function normalizePublic(testCase) {
  return parseFragment(testCase.html, testCase.context, testCase.options).children.map(normalizePublicNode);
}

async function normalizeBrowser(page, testCase) {
  return page.evaluate(async (candidate) => {
    const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
    const documentMarkup = candidate.options?.documentMode === "quirks"
      ? "<html><head></head><body></body></html>"
      : candidate.options?.documentMode === "limited-quirks"
        ? '<!doctype html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html><head></head><body></body></html>'
        : "<!doctype html><html><head></head><body></body></html>";
    const iframe = globalThis.document.createElement("iframe");
    if (candidate.options?.scriptingMode === "disabled") {
      iframe.setAttribute("sandbox", "allow-same-origin");
    }
    globalThis.document.body.appendChild(iframe);
    const owner = iframe.contentDocument;
    owner.open();
    owner.write(documentMarkup);
    owner.close();

    try {
      const normalize = (node) => {
        if (node.nodeType === globalThis.Node.TEXT_NODE) return ["text", node.nodeValue ?? ""];
        if (node.nodeType === globalThis.Node.COMMENT_NODE) return ["comment", node.nodeValue ?? ""];
        if (node.nodeType === globalThis.Node.PROCESSING_INSTRUCTION_NODE) {
          return ["processingInstruction", node.nodeName, node.nodeValue ?? ""];
        }
        if (node.nodeType === globalThis.Node.DOCUMENT_TYPE_NODE) {
          return ["doctype", node.name ?? "", node.publicId ?? "", node.systemId ?? ""];
        }
        if (node.nodeType !== globalThis.Node.ELEMENT_NODE) return ["other", node.nodeType];
        const attributes = Array.from(node.attributes)
          .map((attribute) => [attribute.namespaceURI, attribute.localName, attribute.value])
          .sort((left, right) => {
            const leftKey = JSON.stringify(left);
            const rightKey = JSON.stringify(right);
            return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
          });
        const parent = node.localName === "template" ? node.content : node;
        return [
          "element",
          node.namespaceURI,
          node.localName,
          attributes,
          Array.from(parent.childNodes).map(normalize)
        ];
      };
      const element = owner.createElementNS(candidate.context.namespaceUri, candidate.context.localName);
      for (const attribute of candidate.context.attributes) {
        const prefix = attribute.namespaceUri === "http://www.w3.org/1999/xlink"
          ? "xlink"
          : attribute.namespaceUri === "http://www.w3.org/XML/1998/namespace"
            ? "xml"
            : attribute.namespaceUri === "http://www.w3.org/2000/xmlns/" &&
                attribute.localName !== "xmlns"
              ? "xmlns"
              : null;
        element.setAttributeNS(
          attribute.namespaceUri,
          prefix === null ? attribute.localName : `${prefix}:${attribute.localName}`,
          attribute.value
        );
      }
      if (candidate.options?.hasFormInContextChain === true && !(
        element.namespaceURI === HTML_NAMESPACE && element.localName === "form"
      )) {
        const form = owner.createElement("form");
        form.appendChild(element);
        owner.body.appendChild(form);
      } else {
        owner.body.appendChild(element);
      }
      element.innerHTML = candidate.html;
      const parent = element.namespaceURI === HTML_NAMESPACE && element.localName === "template"
        ? element.content
        : element;
      return Array.from(parent.childNodes).map(normalize);
    } finally {
      iframe.remove();
    }
  }, testCase);
}

if (
  process.platform === "linux" &&
  process.env["PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS"] === undefined
) {
  process.env["PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS"] = "1";
}

const engines = Object.freeze([
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit]
]);
const results = [];
for (const [name, launcher] of engines) {
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
    const failures = [];
    const acceptedDifferences = [];
    const outcomes = [];
    for (const testCase of CASES) {
      const publicTree = normalizePublic(testCase);
      const browserTree = await normalizeBrowser(page, testCase);
      outcomes.push({ id: testCase.id, publicTree, browserTree });
      if (JSON.stringify(publicTree) === JSON.stringify(browserTree)) continue;
      const difference = {
        id: testCase.id,
        publicSha256: sha256(publicTree),
        browserSha256: sha256(browserTree)
      };
      const accepted = testCase.acceptedBrowserTrees?.[name];
      if (
        accepted?.publicSha256 === difference.publicSha256 &&
        accepted.browserSha256 === difference.browserSha256
      ) {
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
      version: browser.version(),
      status: "fail",
      cases: CASES.length,
      failures: [{
        id: "browser-harness",
        reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      }]
    });
  } finally {
    await browser.close();
  }
}

const report = {
  schema: "public-fragment-browser-diff/v1",
  generatedAt: new Date().toISOString(),
  cases: CASES.length,
  results
};
await writeJson("reports/public-fragment-browser-diff.json", report);
console.log(JSON.stringify(report));
if (results.some((result) => result.status !== "pass")) process.exitCode = 1;
