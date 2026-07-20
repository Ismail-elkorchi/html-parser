import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
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

const FIXTURE_ROOT = "test/fixtures/upstream/wpt-tree-construction/resources";
const CORPUS_MANIFEST_PATH = "test/fixtures/upstream/wpt-tree-construction/manifest.json";
const CLASSIFICATION_PATH = "test/fixtures/qualification/wpt-tree-classifications.json";
const QUALIFICATION_REPORT_PATH = "reports/engine-wpt-tree.json";

const ASSIGNMENTS = Object.freeze({
  "adoption01.dat": Object.freeze({ cases: Object.freeze([1, 2, 3, 4, 5, 7, 8, 9, 10, 14, 15, 16, 17]) }),
  "adoption02.dat": Object.freeze({ cases: Object.freeze([1, 2]) }),
  "blocks.dat": Object.freeze({ first: 1, last: 48 }),
  "comments01.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "doctype01.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "inbody01.dat": Object.freeze({ first: 1, last: 4 }),
  "main-element.dat": Object.freeze({ first: 1, last: 2 }),
  "noscript01.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "processing-instructions.dat": Object.freeze({ first: 1, last: 24 }),
  "plain-text-unsafe.dat": Object.freeze({ cases: Object.freeze([8, 9]) }),
  "scriptdata01.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "search-element.dat": Object.freeze({ first: 1, last: 2 }),
  "tables01.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "template.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "tests8.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "tests9.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "tests10.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "tests11.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "tests12.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "tests20.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "tests21.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "tests22.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "tests23.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "tests24.dat": Object.freeze({ first: 1, last: Number.POSITIVE_INFINITY }),
  "ruby.dat": Object.freeze({ first: 1, last: 21 }),
  "tests2.dat": Object.freeze({ cases: Object.freeze([5]) }),
  "tests3.dat": Object.freeze({ cases: Object.freeze([17, 18, 19, 20, 21, 22]) }),
  "tests6.dat": Object.freeze({ cases: Object.freeze([2]) }),
  "tests15.dat": Object.freeze({ cases: Object.freeze([2, 3]) }),
  "tests19.dat": Object.freeze({
    cases: Object.freeze([
      2, 3, 4, 5, 6, 7,
      9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
      22, 23, 24, 30, 89, 92, 96, 97, 98, 99, 100, 101, 102, 103
    ])
  }),
  "tests26.dat": Object.freeze({ cases: Object.freeze([1, 2, 5, 6, 7, 8, 9, 10, 15, 16]) }),
  "tests25.dat": Object.freeze({ cases: Object.freeze([7, 10]) }),
  "tricky01.dat": Object.freeze({ cases: Object.freeze([1]) }),
  "void-in-phrasing.dat": Object.freeze({ first: 1, last: 13 })
});
const requestedCase = process.env["ENGINE_FIXTURE_CASE"];
const qualificationRun = process.argv.includes("--qualification") ||
  process.env["ENGINE_QUALIFICATION"] === "1";
const includeAllDocumentCases = qualificationRun || process.env["ENGINE_ALL_DOCUMENT_CASES"] === "1";

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

function isAssigned(caseNumber, assignment) {
  return "cases" in assignment
    ? assignment.cases.includes(caseNumber)
    : caseNumber >= assignment.first && caseNumber <= assignment.last;
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
const fixtureFiles = (await readdir(FIXTURE_ROOT))
  .filter((fileName) => fileName.endsWith(".dat"))
  .sort();
for (const fileName of fixtureFiles) {
  const assignment = ASSIGNMENTS[fileName];
  const filePath = path.join(FIXTURE_ROOT, fileName);
  const content = await readFile(filePath, "utf8");
  const cases = parseTreeDatFixtures(content, filePath)
    .filter((fixtureCase) =>
      (fixtureCase.fragmentContext !== null ||
        includeAllDocumentCases ||
        (assignment !== undefined && isAssigned(fixtureCase.caseNumber, assignment))) &&
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

if (qualificationRun) {
  const classificationFile = JSON.parse(await readFile(CLASSIFICATION_PATH, "utf8"));
  const corpusManifest = JSON.parse(await readFile(CORPUS_MANIFEST_PATH, "utf8"));
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
    suite: "independent-engine-wpt-tree",
    generatedAt: new Date().toISOString(),
    corpusCommit: corpusManifest.commit,
    corpusCompositeSha256: corpusManifest.compositeSha256,
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
  await writeFile(QUALIFICATION_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (unexpected.length > 0 || unobserved.length > 0 || executed !== passed + classified.length) {
    process.exitCode = 1;
  }
} else if (failures.length > 0) {
  const treeOrRuntimeFailures = failures.filter((failure) =>
    "error" in failure || failure.expected !== failure.actual
  ).length;
  const failureGroups = {};
  for (const failure of failures) {
    const match = /resources\/(.+\.dat)#(\d+)@/.exec(failure.id);
    const fileName = match?.[1] ?? "unknown";
    const caseNumber = Number(match?.[2] ?? 0);
    const kind = "error" in failure
      ? "runtime"
      : failure.expected === failure.actual ? "diagnostic" : "tree";
    const key = `${fileName}:${kind}`;
    const group = failureGroups[key] ?? { executions: 0, cases: new Set() };
    group.executions += 1;
    group.cases.add(caseNumber);
    failureGroups[key] = group;
  }
  const summarizedGroups = Object.fromEntries(Object.entries(failureGroups).map(([key, group]) => [
    key,
    { executions: group.executions, cases: [...group.cases].sort((left, right) => left - right) }
  ]));
  console.error(JSON.stringify({
    executed,
    chunkExecutions,
    passed,
    failed: failures.length,
    treeOrRuntimeFailures,
    diagnosticCountOnlyFailures: failures.length - treeOrRuntimeFailures,
    failureGroups: summarizedGroups,
    failures: failures.slice(0, 20)
  }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    executed,
    chunkExecutions,
    passed,
    failed: 0
  }));
}
