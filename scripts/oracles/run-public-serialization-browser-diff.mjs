import { createHash } from "node:crypto";

import { chromium, firefox, webkit } from "playwright";

import {
  PUBLIC_SERIALIZATION_QUALIFICATION_CASES,
  runPublicSerializationQualificationCase
} from "../../test/support/public-serialization-qualification-cases.mjs";
import { writeJson } from "../eval/eval-primitives.mjs";

const ENGINES = Object.freeze([
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit]
]);

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function nativeSerialization(page, testCase) {
  return page.evaluate((candidate) => {
    const owner = candidate.browserEnvironment === "disabled"
      ? new globalThis.DOMParser().parseFromString("<!doctype html><html><body></body></html>", "text/html")
      : globalThis.document;
    const build = (descriptor) => {
      if (descriptor.type === "text") return owner.createTextNode(descriptor.value);
      if (descriptor.type === "comment") return owner.createComment(descriptor.value);
      if (descriptor.type === "processingInstruction") {
        return owner.createProcessingInstruction(descriptor.target, descriptor.data);
      }
      const node = owner.createElementNS(descriptor.namespaceUri, descriptor.qualifiedName);
      for (const attribute of descriptor.attributes) {
        node.setAttributeNS(attribute.namespaceUri, attribute.qualifiedName, attribute.value);
      }
      const parent = descriptor.templateChildren === undefined ? node : node.content;
      const children = descriptor.templateChildren ?? descriptor.children;
      for (const child of children) parent.appendChild(build(child));
      return node;
    };
    const node = build(candidate.descriptor);
    if (node.nodeType === globalThis.Node.ELEMENT_NODE) return node.outerHTML;
    const container = owner.createElement("div");
    container.appendChild(node);
    return container.innerHTML;
  }, testCase);
}

if (
  process.platform === "linux" &&
  process.env["PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS"] === undefined
) {
  process.env["PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS"] = "1";
}

const cases = PUBLIC_SERIALIZATION_QUALIFICATION_CASES.filter((testCase) => testCase.browserApplicable);
const results = [];
for (const [name, launcher] of ENGINES) {
  let browser;
  try {
    browser = await launcher.launch({ headless: true });
    const page = await browser.newPage();
    const failures = [];
    const acceptedDifferences = [];
    const outcomes = [];
    for (const testCase of cases) {
      const publicOutput = runPublicSerializationQualificationCase(testCase);
      const browserOutput = await nativeSerialization(page, testCase);
      outcomes.push({ id: testCase.id, publicOutput, browserOutput });
      if (publicOutput !== testCase.expected) {
        failures.push({
          id: testCase.id,
          reason: "public-output-mismatch",
          expected: testCase.expected,
          publicOutput,
          browserOutput
        });
        continue;
      }
      if (browserOutput !== testCase.expected) {
        const accepted = testCase.acceptedBrowserOutputs[name];
        if (accepted?.output === browserOutput) {
          acceptedDifferences.push({
            id: testCase.id,
            expected: testCase.expected,
            browserOutput,
            reason: accepted.reason
          });
        } else {
          failures.push({
            id: testCase.id,
            reason: "browser-output-mismatch",
            expected: testCase.expected,
            publicOutput,
            browserOutput
          });
        }
      }
    }
    results.push({
      name,
      version: browser.version(),
      status: failures.length === 0 ? "pass" : "fail",
      cases: cases.length,
      outcomesSha256: sha256(outcomes),
      acceptedDifferences,
      failures
    });
  } catch (error) {
    results.push({
      name,
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await browser?.close();
  }
}

const report = {
  schema: "public-serialization-browser-diff/v1",
  generatedAt: new Date().toISOString(),
  cases: cases.length,
  results
};
await writeJson("reports/public-serialization-browser-diff.json", report);
console.log(JSON.stringify(report));
if (results.some((result) => result.status !== "pass")) process.exitCode = 1;
