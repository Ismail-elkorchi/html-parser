import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  MATHML_NAMESPACE,
  SVG_NAMESPACE,
  XLINK_NAMESPACE,
  XML_NAMESPACE,
  XMLNS_NAMESPACE,
  runHtmlEngine
} from "../../dist/internal/html-engine/mod.js";
import { expandTreeDatCases, parseTreeDatFixtures } from "../../test/support/tree-dat.mjs";

const FIXTURE_ROOT = "test/fixtures/upstream/wpt-tree-construction/resources";
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
  attributes.sort((left, right) => left.name.localeCompare(right.name));
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
      const parent = entry.node.templateContents ?? entry.node;
      const children = childArray(parent);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) stack.push({ node: child, level: entry.level + 1 });
      }
    }
  }
  return lines.join("\n");
}

const failures = [];
let executed = 0;
for (const [fileName, assignment] of Object.entries(ASSIGNMENTS)) {
  const filePath = path.join(FIXTURE_ROOT, fileName);
  const content = await readFile(filePath, "utf8");
  const cases = parseTreeDatFixtures(content, filePath)
    .filter((fixtureCase) =>
      fixtureCase.fragmentContext === null &&
      isAssigned(fixtureCase.caseNumber, assignment)
    );
  for (const fixtureCase of expandTreeDatCases(cases, { includeModeInId: true })) {
    executed += 1;
    try {
      const result = runHtmlEngine({
        inputChunks: [fixtureCase.data],
        parser: {
          kind: "document",
          scriptingMode: fixtureCase.scriptingEnabled ? "inert" : "disabled"
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
      const parseErrorCountMatches =
        !fixtureCase.errorsDeclared || result.parseErrors.length === fixtureCase.errors.length;
      if (actual !== fixtureCase.expected || !parseErrorCountMatches) {
        failures.push({
          id: fixtureCase.id,
          expected: fixtureCase.expected,
          actual,
          expectedParseErrors: fixtureCase.errorsDeclared ? fixtureCase.errors.length : null,
          actualParseErrors: result.parseErrors.length
        });
      }
    } catch (error) {
      failures.push({
        id: fixtureCase.id,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      });
    }
  }
}

if (failures.length > 0) {
  console.error(JSON.stringify({ executed, failed: failures.length, failures: failures.slice(0, 20) }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ executed, passed: executed, failed: 0 }));
}
