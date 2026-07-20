import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  MATHML_NAMESPACE,
  SVG_NAMESPACE,
  XLINK_NAMESPACE,
  XML_NAMESPACE,
  XMLNS_NAMESPACE
} from "../../dist/internal/html-engine/namespaces.js";
import { runHtmlEngine } from "../../dist/internal/html-engine/parser-driver.js";
import { expandTreeDatCases, parseTreeDatFixtures } from "../../test/support/tree-dat.mjs";
import { verifyWptTreeCorpus } from "../../test/support/wpt-tree-corpus.mjs";
import { writeJson } from "../lib/report.mjs";

const CLASSIFICATION_PATH = "test/fixtures/qualification/wpt-tree-classifications.json";
const REPORT_PATH = "reports/wpt-tree.json";
const requestedCase = process.env["HTML_PARSER_WPT_CASE"];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function failureSignature(failure) {
  const payload = "error" in failure
    ? { error: failure.error }
    : {
        expected: failure.expected,
        actual: failure.actual,
        expectedParseErrors: failure.expectedParseErrors,
        actualParseErrors: failure.actualParseErrors
      };
  return sha256(JSON.stringify(payload));
}

function quote(value) {
  return `"${value}"`;
}

function elementName(node) {
  if (node.namespaceUri === SVG_NAMESPACE) return `svg ${node.localName}`;
  if (node.namespaceUri === MATHML_NAMESPACE) return `math ${node.localName}`;
  return node.localName;
}

function attributeName(attribute) {
  if (attribute.namespaceUri === XLINK_NAMESPACE) return `xlink ${attribute.localName}`;
  if (attribute.namespaceUri === XML_NAMESPACE) return `xml ${attribute.localName}`;
  if (attribute.namespaceUri === XMLNS_NAMESPACE) return `xmlns ${attribute.localName}`;
  return attribute.qualifiedName;
}

function serializeNode(node, level, lines) {
  const indentation = "  ".repeat(level);
  if (node.kind === "text") {
    lines.push(`| ${indentation}${quote(node.data)}`);
    return;
  }
  if (node.kind === "comment") {
    lines.push(`| ${indentation}<!-- ${node.data} -->`);
    return;
  }
  if (node.kind === "processing-instruction") {
    lines.push(`| ${indentation}<?${node.target} ${node.data}?>`);
    return;
  }
  if (node.kind === "doctype") {
    if (node.externalId.kind === "public") {
      lines.push(`| ${indentation}<!DOCTYPE ${node.name} ${quote(node.externalId.publicIdentifier)} ${quote(node.externalId.systemIdentifier ?? "")}>`);
    } else if (node.externalId.kind === "system") {
      lines.push(`| ${indentation}<!DOCTYPE ${node.name} ${quote("")} ${quote(node.externalId.systemIdentifier)}>`);
    } else {
      lines.push(`| ${indentation}<!DOCTYPE ${node.name}>`);
    }
    return;
  }
  lines.push(`| ${indentation}<${elementName(node)}>`);
  const attributes = [];
  for (let index = 0; index < node.attributeCount; index += 1) {
    const attribute = node.attributeAt(index);
    if (attribute !== null) {
      attributes.push({ name: attributeName(attribute), value: attribute.value });
    }
  }
  attributes.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const attribute of attributes) {
    lines.push(`| ${"  ".repeat(level + 1)}${attribute.name}=${quote(attribute.value)}`);
  }
}

function childArray(parent) {
  const children = [];
  for (let index = 0; index < parent.childCount; index += 1) {
    const child = parent.childAt(index);
    if (child !== null) children.push(child);
  }
  return children;
}

function serializeModel(model) {
  const lines = [];
  const stack = childArray(model.root).reverse().map((node) => ({ node, level: 0 }));
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    serializeNode(entry.node, entry.level, lines);
    if (entry.node.kind === "element") {
      const templateContents = entry.node.templateContents;
      const parent = templateContents ?? entry.node;
      const childLevel = templateContents === null ? entry.level + 1 : entry.level + 2;
      if (templateContents !== null) {
        lines.push(`| ${"  ".repeat(entry.level + 1)}content`);
      }
      const children = childArray(parent);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) stack.push({ node: child, level: childLevel });
      }
    }
  }
  return lines.join("\n");
}

const failures = [];
let executed = 0;
let passed = 0;
let chunkExecutions = 0;
const corpus = await verifyWptTreeCorpus();
for (const relativePath of corpus.fixtureFiles) {
  const fileName = path.basename(relativePath);
  const filePath = path.join(corpus.corpusRoot, relativePath);
  const fixtureIdPath = path.relative(corpus.repositoryRoot, filePath).split(path.sep).join("/");
  const content = await readFile(filePath, "utf8");
  const cases = parseTreeDatFixtures(content, fixtureIdPath)
    .filter((fixtureCase) =>
      (requestedCase === undefined || requestedCase === `${fileName}#${String(fixtureCase.caseNumber)}`)
    );
  for (const fixtureCase of expandTreeDatCases(cases, { includeModeInId: true })) {
    executed += 1;
    const schedules = fixtureCase.fragmentContext === null
      ? [{ name: "whole", inputChunks: [fixtureCase.data] }]
      : [
          { name: "whole", inputChunks: [fixtureCase.data] },
          {
            name: "utf16-unit",
            inputChunks: Array.from(
              { length: fixtureCase.data.length },
              (_, index) => fixtureCase.data[index] ?? ""
            )
          }
        ];
    let fixturePassed = true;
    for (const schedule of schedules) {
      chunkExecutions += 1;
      try {
        const result = runHtmlEngine({
          inputChunks: schedule.inputChunks,
          parser: fixtureCase.fragmentContext === null
            ? {
                kind: "document",
                scriptingMode: fixtureCase.scriptingEnabled ? "inert" : "disabled"
              }
              : {
                kind: "fragment",
                scriptingMode: fixtureCase.scriptingEnabled ? "inert" : "disabled",
                documentMode: "no-quirks",
                hasFormInContextChain: false,
                context: { ...fixtureCase.fragmentContext, attributes: [] }
              },
          limits: {
            maxSteps: 1_000_000,
            maxNodes: 100_000,
            maxDepth: 10_000,
            maxParseErrors: 100_000,
            maxAttributesPerElement: 10_000,
            maxAttributeUtf8BytesPerElement: 10_000_000
          }
        });
        const actual = serializeModel(result.model);
        const actualUnnamedParseErrorCount = result.parseErrors.length;
        const actualNamedParseErrorCount = result.parseErrors
          .filter((error) => error.code !== "unexpected-token").length;
        const unnamedParseErrorCountMatches =
          !fixtureCase.sawUnnamedErrors ||
          actualUnnamedParseErrorCount === fixtureCase.unnamedErrors.length;
        const namedParseErrorCountMatches =
          !fixtureCase.sawNamedErrors || actualNamedParseErrorCount === fixtureCase.namedErrors.length;
        if (actual !== fixtureCase.expected ||
          !unnamedParseErrorCountMatches ||
          !namedParseErrorCountMatches) {
          fixturePassed = false;
          failures.push({
            id: `${fixtureCase.id}#chunk-${schedule.name}`,
            expected: fixtureCase.expected,
            actual,
            expectedParseErrors: {
              unnamed: fixtureCase.sawUnnamedErrors ? fixtureCase.unnamedErrors.length : null,
              named: fixtureCase.sawNamedErrors ? fixtureCase.namedErrors.length : null
            },
            actualParseErrors: {
              unnamed: actualUnnamedParseErrorCount,
              named: actualNamedParseErrorCount
            }
          });
        }
      } catch (error) {
        fixturePassed = false;
        failures.push({
          id: `${fixtureCase.id}#chunk-${schedule.name}`,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        });
      }
    }
    if (fixturePassed) passed += 1;
  }
}

{
  const classificationFile = JSON.parse(await readFile(CLASSIFICATION_PATH, "utf8"));
  const corpusManifest = corpus.manifest;
  if (classificationFile.schemaVersion !== 1 || !Array.isArray(classificationFile.entries)) {
    throw new Error("WPT tree classification manifest must use schemaVersion 1 and contain entries");
  }
  if (
    classificationFile.corpusCommit !== corpusManifest.commit ||
    classificationFile.corpusCompositeSha256 !== corpusManifest.compositeSha256
  ) {
    throw new Error("WPT tree classification manifest does not match the pinned corpus");
  }

  const acceptedKinds = new Set(["requires-script-execution", "standards-drift"]);
  const expectedById = new Map();
  for (const entry of classificationFile.entries) {
    if (
      typeof entry.id !== "string" ||
      typeof entry.signature !== "string" ||
      typeof entry.reason !== "string" ||
      !acceptedKinds.has(entry.classification) ||
      expectedById.has(entry.id)
    ) {
      throw new Error(`Invalid WPT tree classification entry: ${String(entry.id)}`);
    }
    expectedById.set(entry.id, entry);
  }

  const classified = [];
  const unexpected = [];
  for (const failure of failures) {
    const signature = failureSignature(failure);
    const expected = expectedById.get(failure.id);
    if (expected === undefined || expected.signature !== signature) {
      unexpected.push({ id: failure.id, signature });
      continue;
    }
    classified.push({
      id: failure.id,
      signature,
      classification: expected.classification,
      reason: expected.reason
    });
    expectedById.delete(failure.id);
  }
  const unobserved = [...expectedById.values()].map((entry) => ({
    id: entry.id,
    signature: entry.signature,
    classification: entry.classification
  }));
  const classificationCounts = Object.fromEntries(
    [...acceptedKinds].map((kind) => [
      kind,
      classified.filter((entry) => entry.classification === kind).length
    ])
  );
  const report = {
    schemaVersion: 1,
    suite: "html-parser-wpt-tree",
    generatedAt: new Date().toISOString(),
    corpusCommit: corpusManifest.commit,
    corpusCompositeSha256: corpusManifest.compositeSha256,
    cases: {
      total: executed,
      passed: passed + classified.length,
      failed: unexpected.length,
      skipped: 0
    },
    executed,
    chunkExecutions,
    exactPasses: passed,
    classifiedDifferences: classified.length,
    classificationCounts,
    unexpected,
    unobserved,
    outcomesSha256: sha256(JSON.stringify({
      executed,
      passed,
      classified: classified.map(({ id, signature, classification }) => ({ id, signature, classification }))
    }))
  };
  await writeJson(REPORT_PATH, report);
  console.log(JSON.stringify(report, null, 2));
  if (unexpected.length > 0 || unobserved.length > 0 || executed !== passed + classified.length) {
    process.exitCode = 1;
  }
}
