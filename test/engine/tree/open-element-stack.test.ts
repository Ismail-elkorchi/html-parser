import assert from "node:assert/strict";
import test from "node:test";

import { InternalStateError } from "../../../src/internal/foundation/internal-state-error.js";
import {
  HTML_NAMESPACE,
  MATHML_NAMESPACE,
  HtmlTreeModel,
  OpenElementStack,
  createEngineResourceGuard,
  type HtmlTreeElement
} from "../../../src/internal/html-engine/mod.js";

function element(
  model: HtmlTreeModel,
  localName: string,
  namespaceUri: typeof HTML_NAMESPACE | typeof MATHML_NAMESPACE = HTML_NAMESPACE
): HtmlTreeElement {
  return model.createElement({
    namespaceUri,
    prefix: null,
    localName,
    qualifiedName: localName
  });
}

void test("indexed stack scope queries preserve order across pushes, pops, and middle removals", () => {
  const model = new HtmlTreeModel({ rootKind: "fragment", resources: createEngineResourceGuard() });
  const stack = new OpenElementStack();
  const html = element(model, "html");
  const paragraph = element(model, "p");
  const button = element(model, "button");
  const innerParagraph = element(model, "p");
  const boundaries = new Set(["html", "button"]);

  stack.push(html);
  stack.push(paragraph);
  assert.equal(stack.hasInScope(HTML_NAMESPACE, "p", boundaries), true);
  stack.push(button);
  assert.equal(stack.hasInScope(HTML_NAMESPACE, "p", boundaries), false);
  stack.push(innerParagraph);
  assert.equal(stack.hasInScope(HTML_NAMESPACE, "p", boundaries), true);
  stack.remove(button);
  assert.equal(stack.hasInScope(HTML_NAMESPACE, "p", boundaries), true);
  assert.equal(stack.current(), innerParagraph);
  assert.equal(stack.pop(), innerParagraph);
  assert.equal(stack.current(), paragraph);
});

void test("HTML scope boundaries constrain foreign target lookups", () => {
  const model = new HtmlTreeModel({ rootKind: "fragment", resources: createEngineResourceGuard() });
  const stack = new OpenElementStack();
  const html = element(model, "html");
  const mathTarget = element(model, "mi", MATHML_NAMESPACE);
  const button = element(model, "button");
  const boundaries = new Set(["html", "button"]);

  stack.push(html);
  stack.push(mathTarget);
  assert.equal(stack.hasInScope(MATHML_NAMESPACE, "mi", boundaries), true);
  stack.push(button);
  assert.equal(stack.hasInScope(MATHML_NAMESPACE, "mi", boundaries), false);
  assert.equal(stack.lastInScope(MATHML_NAMESPACE, new Set(["mi"]), boundaries), null);
});

void test("indexed stack rejects duplicate and absent element mutations", () => {
  const model = new HtmlTreeModel({ rootKind: "fragment", resources: createEngineResourceGuard() });
  const stack = new OpenElementStack();
  const html = element(model, "html");
  stack.push(html);
  assert.throws(
    () => { stack.push(html); },
    (error) => error instanceof InternalStateError &&
      error.reason === "TREE_BUILDER_OPEN_ELEMENT_ALREADY_PRESENT"
  );
  stack.pop();
  assert.throws(
    () => { stack.remove(html); },
    (error) => error instanceof InternalStateError &&
      error.reason === "TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT"
  );
});

void test("random-access replacement and insertion preserve identity scope and order", () => {
  const resources = createEngineResourceGuard();
  const model = new HtmlTreeModel({ rootKind: "fragment", resources });
  const stack = new OpenElementStack(resources);
  const html = element(model, "html");
  const bold = element(model, "b");
  const block = element(model, "div");
  const replacement = element(model, "b");
  const inserted = element(model, "i");
  const boundaries = new Set(["html"]);

  stack.push(html);
  stack.push(bold);
  stack.push(block);
  stack.replace(bold, replacement);
  assert.equal(stack.includes(bold), false);
  assert.equal(stack.indexOf(replacement), 1);
  const beforeTailInsertion = resources.snapshot().steps;
  stack.insertAfter(block, inserted);
  assert.equal(resources.snapshot().steps - beforeTailInsertion, 1);
  assert.equal(stack.at(3), inserted);
  assert.equal(stack.hasElementInScope(replacement, boundaries), true);
  assert.equal(stack.hasInScope(HTML_NAMESPACE, "i", boundaries), true);
});
