import assert from "node:assert/strict";
import test from "node:test";

import {
  findAllByAttr,
  findAllByTagName,
  findById,
  parse,
  textContent,
  walk,
  walkElements
} from "../../dist/mod.js";

test("walk and walkElements are deterministic", () => {
  const tree = parse("<article id=\"a\"><h1>x</h1><p data-role=\"lead\">hello</p><p>world</p></article>");

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

test("textContent and find helpers return expected nodes", () => {
  const tree = parse("<section id=\"root\"><h1>x</h1><p data-role=\"lead\">hello</p><p>world</p></section>");

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

  const sectionText = textContent(section);
  assert.equal(sectionText, "xhelloworld");
});
