import { createHash } from "node:crypto";

import { parseFragment, serialize } from "../../dist/mod.js";
import {
  PUBLIC_SERIALIZATION_QUALIFICATION_CASES,
  createPublicSerializationNode
} from "../../test/support/public-serialization-qualification-cases.mjs";
import { writeJson } from "../eval/eval-primitives.mjs";

const POSITIVE_CASES = Object.freeze([
  { id: "ordinary", html: "<p data-x='<>&quot;'>&amp;&nbsp;&lt;&gt;</p>" },
  { id: "script", html: "<script><&></script>" },
  { id: "style", html: "<style><&></style>" },
  { id: "xmp", html: "<xmp><&></xmp>" },
  { id: "iframe", html: "<iframe><&></iframe>" },
  { id: "noembed", html: "<noembed><&></noembed>" },
  { id: "noframes", html: "<noframes><&></noframes>" },
  { id: "noscript-inert", html: "<noscript><&></noscript>" },
  { id: "title", html: "<title>&lt;&amp;&gt;&nbsp;</title>" },
  { id: "textarea", html: "<textarea>&lt;&amp;&gt;&nbsp;</textarea>" },
  { id: "svg", html: "<svg xlink:href='x'><script>&lt;&amp;&gt;</script></svg>" },
  { id: "mathml", html: "<math><mtext><b>x</b></mtext></math>" },
  { id: "template", html: "<template><table><td>x</table></template>" },
  { id: "void-elements", html: "<basefont><frame><keygen><bgsound><br><p>x</p>" },
  { id: "comment", html: "<!--data--><p>x</p>" },
  { id: "processing-instruction", html: "<?target data?><p>x</p>" },
  { id: "foreign-cdata", html: "<svg><![CDATA[<img>]]></svg>" }
]);

const EXPECTED_CLASSIFICATIONS = Object.freeze({
  plaintext: Object.freeze({
    beforeSha256: "ac4edc2c433b880c8cb8a085f602fdd8a8701d0f440eaa1a21d706b76c269850",
    afterSha256: "72e01cd787c5553da6c8b36192919ef58e4ec500bc3f3fb1b26cedc5fa6c9000"
  }),
  "raw-effective-end-tag": Object.freeze({
    beforeSha256: "1cd6db27db0ec08a8b954bc453c59d38b03889328bb9144544cdc797fe633bd5",
    afterSha256: "81fcca8ca804dd52962b8ea723666ac1a876bafd31ab186d2119ddc5b50b1074"
  })
});
const EXPECTED_CLASSIFICATIONS_SHA256 = "86f7cb6d3f42dd40c8ce4f08e2a664fa9c230d1ad2994ed2b1862742a12648f4";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function reportPath() {
  const prefix = "--report=";
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ??
    "reports/public-serialization-roundtrip.json";
}

function normalizeNode(node) {
  if (node.kind === "text" || node.kind === "comment") return [node.kind, node.value];
  if (node.kind === "processingInstruction") return [node.kind, node.target, node.data];
  if (node.kind === "doctype") return [node.kind, node.name, node.externalId];
  if (node.kind === "templateContent") {
    return [node.kind, node.children.map(normalizeNode)];
  }
  return [
    node.kind,
    node.namespaceUri,
    node.localName,
    node.attributes.map((attribute) => [attribute.namespaceUri, attribute.localName, attribute.value]),
    (node.templateContent?.children ?? node.children).map(normalizeNode)
  ];
}

function normalizeNodes(nodes) {
  return nodes.map(normalizeNode);
}

const failures = [];
const positive = [];
for (const testCase of POSITIVE_CASES) {
  const first = parseFragment(testCase.html, "div");
  const serialized = serialize(first);
  const second = parseFragment(serialized, "div");
  const before = normalizeNodes(first.children);
  const after = normalizeNodes(second.children);
  const stable = JSON.stringify(before) === JSON.stringify(after);
  positive.push({
    id: testCase.id,
    serializedSha256: sha256(serialized),
    treeSha256: sha256(before),
    stable
  });
  if (!stable) failures.push({ id: testCase.id, reason: "unexpected-roundtrip-difference" });
}

const plaintextFirst = parseFragment("<plaintext>a<b>", "div");
const plaintextSerialized = serialize(plaintextFirst);
const plaintextSecond = parseFragment(plaintextSerialized, "div");
const rawCase = PUBLIC_SERIALIZATION_QUALIFICATION_CASES.find(
  (testCase) => testCase.id === "classified/raw-effective-end-tag"
);
if (rawCase === undefined) throw new Error("missing raw effective-end-tag qualification case");
const rawNode = createPublicSerializationNode(rawCase.descriptor);
const rawSerialized = serialize(rawNode);
const rawSecond = parseFragment(rawSerialized, "div");

const classified = [
  {
    id: "plaintext",
    reason: "the emitted end tag is consumed as plaintext data when reparsed",
    beforeSha256: sha256(normalizeNodes(plaintextFirst.children)),
    afterSha256: sha256(normalizeNodes(plaintextSecond.children))
  },
  {
    id: "raw-effective-end-tag",
    reason: "literal appropriate end-tag text terminates the raw-text element when reparsed",
    beforeSha256: sha256(normalizeNodes([rawNode])),
    afterSha256: sha256(normalizeNodes(rawSecond.children))
  }
];
for (const classification of classified) {
  const expected = EXPECTED_CLASSIFICATIONS[classification.id];
  if (
    expected?.beforeSha256 !== classification.beforeSha256 ||
    expected.afterSha256 !== classification.afterSha256 ||
    classification.beforeSha256 === classification.afterSha256
  ) {
    failures.push({ ...classification, reason: "classification-fingerprint-mismatch" });
  }
}
const classificationsSha256 = sha256(classified);
if (classificationsSha256 !== EXPECTED_CLASSIFICATIONS_SHA256) {
  failures.push({ reason: "classification-ledger-mismatch", classificationsSha256 });
}

const report = {
  schema: "public-serialization-roundtrip/v1",
  generatedAt: new Date().toISOString(),
  positive,
  classified,
  classificationsSha256,
  failures
};
await writeJson(reportPath(), report);
console.log(JSON.stringify(report));
if (failures.length > 0) process.exitCode = 1;
