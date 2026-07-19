import assert from "node:assert/strict";
import test from "node:test";

import {
  TEXT_CONTENT_POLICY,
  extractText,
  findAllByAttr,
  findAllByTagName,
  findById,
  outline,
  parse,
  walk,
  walkElements
} from "../../dist/mod.js";

test("walk and walkElements are deterministic", () => {
  const { tree } = parse("<article id=\"a\"><h1>x</h1><p data-role=\"lead\">hello</p><p>world</p></article>");

  const firstWalk = [];
  walk(tree, (node, depth) => {
    firstWalk.push(`${String(depth)}:${node.kind}:${node.kind === "element" ? node.tagName : ""}`);
  });

  const secondWalk = [];
  walk(tree, (node, depth) => {
    secondWalk.push(`${String(depth)}:${node.kind}:${node.kind === "element" ? node.tagName : ""}`);
  });

  assert.deepEqual(firstWalk, secondWalk);

  const firstElements = [];
  walkElements(tree, (node, depth) => {
    firstElements.push(`${String(depth)}:${node.tagName}`);
  });
  const secondElements = [];
  walkElements(tree, (node, depth) => {
    secondElements.push(`${String(depth)}:${node.tagName}`);
  });

  assert.deepEqual(firstElements, secondElements);
  assert.ok(firstElements.length >= 3);
});

test("outline entry text uses a scalar-safe 200-byte UTF-8 prefix", () => {
  const { tree } = parse(`<h1>${"😀".repeat(100)}Z</h1>`);
  const entry = outline(tree).entries[0];
  assert.ok(entry);
  assert.equal(new TextEncoder().encode(entry.text).byteLength, 200);
  assert.equal(entry.text, "😀".repeat(50));
  assert.equal(/^[\uD800-\uDBFF]$/u.test(entry.text.at(-1) ?? ""), false);
});

test("bounded raw extraction and find helpers return expected nodes", () => {
  const { tree } = parse("<section id=\"root\"><h1>x</h1><p data-role=\"lead\">hello</p><p>world</p></section>");

  const sections = [...findAllByTagName(tree, "section")];
  assert.equal(sections.length, 1);

  const leads = [...findAllByAttr(tree, "data-role", "lead")];
  assert.equal(leads.length, 1);
  assert.equal(leads[0]?.kind, "element");
  assert.equal(leads[0]?.tagName, "p");

  const section = sections[0];
  assert.ok(section);
  const byId = findById(tree, section.id);
  assert.equal(byId?.id, section.id);

  const sectionText = extractText(section, {
    policy: TEXT_CONTENT_POLICY,
    maxOutputBytes: 100,
    maxTokens: 100
  });
  assert.deepEqual(sectionText, {
    text: "xhelloworld",
    totalBytes: 11,
    truncated: false,
    policy: TEXT_CONTENT_POLICY
  });
});
