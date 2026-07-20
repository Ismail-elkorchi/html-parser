import assert from "node:assert/strict";
import test from "node:test";

import { InternalStateError } from "../../../src/internal/foundation/internal-state-error.js";
import {
  HTML_NAMESPACE,
  MATHML_NAMESPACE,
  SVG_NAMESPACE,
  XML_NAMESPACE,
  EngineResourceLimitError,
  HtmlTreeModel,
  createEngineResourceGuard,
  sourceSpan,
  type HtmlTreeAttributeInput,
  type HtmlTreeElement,
  type HtmlTreeModelErrorReason,
  type HtmlTreeParent,
  type TreeMutationObservation
} from "../../../src/internal/html-engine/mod.js";

function element(
  model: HtmlTreeModel,
  localName: string,
  attributes: readonly HtmlTreeAttributeInput[] = []
): HtmlTreeElement {
  return model.createElement({
    namespaceUri: HTML_NAMESPACE,
    prefix: null,
    localName,
    qualifiedName: localName,
    attributes
  });
}

function assertModelError(action: () => unknown, reason: HtmlTreeModelErrorReason): void {
  assert.throws(
    action,
    (error) => error instanceof InternalStateError && error.reason === reason
  );
}

void test("model retains exact node, namespace, doctype, attribute, and span data", () => {
  const model = new HtmlTreeModel({
    rootKind: "document",
    resources: createEngineResourceGuard()
  });
  const doctype = model.createDoctype({
    name: "html",
    externalId: { kind: "public", publicIdentifier: "", systemIdentifier: null },
    sourceSpan: sourceSpan(0, 15)
  });
  const html = model.createElement({
    namespaceUri: HTML_NAMESPACE,
    prefix: null,
    localName: "html",
    qualifiedName: "html",
    attributes: [
      {
        namespaceUri: null,
        prefix: null,
        localName: "lang",
        qualifiedName: "lang",
        value: "en",
        sourceSpan: sourceSpan(21, 30)
      },
      {
        namespaceUri: XML_NAMESPACE,
        prefix: "xml",
        localName: "lang",
        qualifiedName: "xml:lang",
        value: "fr"
      }
    ],
    sourceSpan: sourceSpan(15, 31)
  });

  model.append(model.root, doctype);
  model.append(model.root, html);

  assert.equal(model.root.identity.serial, 1);
  assert.equal(doctype.identity.serial, 2);
  assert.equal(html.identity.serial, 3);
  assert.deepEqual(doctype.externalId, {
    kind: "public",
    publicIdentifier: "",
    systemIdentifier: null
  });
  assert.deepEqual(html.sourceSpan, { startUtf16Offset: 15, endUtf16Offset: 31 });
  assert.deepEqual(html.attributeAt(0), {
    namespaceUri: null,
    prefix: null,
    localName: "lang",
    qualifiedName: "lang",
    value: "en",
    sourceSpan: { startUtf16Offset: 21, endUtf16Offset: 30 }
  });
  assert.equal(model.attribute(html, XML_NAMESPACE, "lang")?.value, "fr");
  assert.deepEqual(model.validate(), { allocatedNodes: 3, attachedNodes: 3, maxDepth: 2 });
  assertModelError(
    () => {
      model.createElement({
        namespaceUri: HTML_NAMESPACE,
        prefix: null,
        localName: "p",
        qualifiedName: "p",
        attributes: [{
          namespaceUri: XML_NAMESPACE,
          prefix: null,
          localName: "lang",
          qualifiedName: "lang",
          value: "en"
        }]
      });
    },
    "TREE_MODEL_ATTRIBUTE_NAMESPACE_PREFIX_MISMATCH"
  );
});

void test("processing instructions retain their distinct node identity and source data", () => {
  const model = new HtmlTreeModel({ rootKind: "document", resources: createEngineResourceGuard() });
  const instruction = model.createProcessingInstruction("xml-stylesheet", "href=x", sourceSpan(0, 31));
  model.append(model.root, instruction);
  assert.equal(instruction.kind, "processing-instruction");
  assert.equal(instruction.target, "xml-stylesheet");
  assert.equal(instruction.data, "href=x");
  assert.deepEqual(instruction.sourceSpan, { startUtf16Offset: 0, endUtf16Offset: 31 });
  assertModelError(
    () => { model.createProcessingInstruction("", "x"); },
    "TREE_MODEL_EMPTY_PROCESSING_INSTRUCTION_TARGET"
  );
});

void test("template contents have distinct identity, resource cost, depth, and insertion ownership", () => {
  const resources = createEngineResourceGuard({ limits: { maxNodes: 4, maxDepth: 4 } });
  const model = new HtmlTreeModel({ rootKind: "fragment", resources });
  const template = element(model, "template");
  const child = element(model, "p");
  model.append(model.root, template);
  assert.equal(resources.snapshot().maxDepth, 3);
  model.append(template, child);

  const contents = template.templateContents;
  assert.equal(template.childCount, 0);
  assert.ok(contents);
  assert.notEqual(contents.identity.serial, template.identity.serial);
  assert.equal(contents.host, template);
  assert.equal(contents.childAt(0), child);
  assert.equal(child.parent, contents);
  assert.deepEqual([...model.walk()].map(({ node, depth }) => [node.kind, depth]), [
    ["element", 2],
    ["element", 4]
  ]);
  assert.deepEqual(model.validate(), { allocatedNodes: 4, attachedNodes: 4, maxDepth: 4 });
  assert.deepEqual(resources.snapshot(), {
    steps: 6,
    nodes: 4,
    maxDepth: 4,
    parseErrors: 0,
    attributes: 0,
    attributeUtf8Bytes: 0
  });
});

void test("insert-before, moves, detach, and document rules preserve one direct tree", () => {
  const model = new HtmlTreeModel({ rootKind: "document", resources: createEngineResourceGuard() });
  const doctype = model.createDoctype({ name: "html", externalId: { kind: "none" } });
  const html = element(model, "html");
  const head = element(model, "head");
  const body = element(model, "body");
  model.append(model.root, doctype);
  model.append(model.root, html);
  model.append(html, body);
  model.insertBefore(html, head, body);
  model.insertBefore(html, body, body);

  assert.equal(html.childAt(0), head);
  assert.equal(html.childAt(1), body);
  model.insertBefore(html, body, head);
  assert.equal(html.childAt(0), body);
  assert.equal(html.childAt(1), head);
  assert.equal(model.detach(body), true);
  assert.equal(model.detach(body), false);
  assert.equal(body.parent, null);

  assertModelError(
    () => { model.append(model.root, element(model, "other")); },
    "TREE_MODEL_DUPLICATE_DOCUMENT_ELEMENT"
  );
  assertModelError(
    () => { model.append(html, doctype); },
    "TREE_MODEL_DOCTYPE_UNDER_NON_DOCUMENT"
  );
  assertModelError(() => { model.append(html, html); }, "TREE_MODEL_ANCESTOR_CYCLE");
  assert.equal(model.insertText(model.root, "x", sourceSpan(0, 1)), null);
  const detachedText = model.createText("x", sourceSpan(0, 1));
  assertModelError(
    () => { model.append(model.root, detachedText); },
    "TREE_MODEL_TEXT_UNDER_DOCUMENT"
  );

  const orderModel = new HtmlTreeModel({
    rootKind: "document",
    resources: createEngineResourceGuard()
  });
  const orderElement = element(orderModel, "html");
  const lateDoctype = orderModel.createDoctype({ name: "html", externalId: { kind: "none" } });
  orderModel.append(orderModel.root, orderElement);
  assertModelError(
    () => { orderModel.append(orderModel.root, lateDoctype); },
    "TREE_MODEL_DOCTYPE_AFTER_DOCUMENT_ELEMENT"
  );
});

void test("bulk child moves preserve order, parents, depths, and linear observations", () => {
  const observations: TreeMutationObservation[] = [];
  const model = new HtmlTreeModel({
    rootKind: "fragment",
    resources: createEngineResourceGuard(),
    observer: { onTreeMutation(observation) { observations.push(observation); } }
  });
  const source = element(model, "div");
  const destination = element(model, "b");
  const first = element(model, "i");
  const second = model.createText("two");
  model.append(model.root, source);
  model.append(source, first);
  model.append(source, second);

  const beforeMove = observations.length;
  assert.equal(model.moveChildren(source, destination), 2);
  assert.equal(source.childCount, 0);
  assert.equal(destination.childAt(0), first);
  assert.equal(destination.childAt(1), second);
  assert.equal(first.parent, destination);
  assert.equal(second.parent, destination);
  assert.deepEqual(
    observations.slice(beforeMove).map(({ kind, node }) => [kind, node]),
    [
      ["node-detached", first.identity.serial],
      ["node-inserted", first.identity.serial],
      ["node-detached", second.identity.serial],
      ["node-inserted", second.identity.serial]
    ]
  );
  model.append(source, destination);
  assert.deepEqual(model.validate(), { allocatedNodes: 5, attachedNodes: 5, maxDepth: 4 });
});

void test("deep clone replacement is spanless, exact, and commits only after resource preflight", () => {
  function scenario(maxNodes?: number) {
    const resources = createEngineResourceGuard(
      maxNodes === undefined ? {} : { limits: { maxNodes } }
    );
    const model = new HtmlTreeModel({ rootKind: "fragment", resources });
    const source = element(model, "option");
    const destination = element(model, "selectedcontent");
    const previous = model.createText("old", sourceSpan(0, 3));
    const nested = element(model, "b", [{
      namespaceUri: null,
      prefix: null,
      localName: "class",
      qualifiedName: "class",
      value: "label",
      sourceSpan: sourceSpan(4, 9)
    }]);
    const text = model.createText("new", sourceSpan(10, 13));
    model.append(model.root, source);
    model.append(model.root, destination);
    model.append(destination, previous);
    model.append(source, nested);
    model.append(nested, text);
    return { model, source, destination, previous, nested, text };
  }

  const successful = scenario();
  assert.equal(successful.model.replaceChildrenWithClones(
    successful.source,
    successful.destination
  ), 1);
  const clone = successful.destination.childAt(0);
  assert.equal(clone?.kind, "element");
  assert.notEqual(clone, successful.nested);
  assert.equal(clone.sourceSpan, null);
  assert.equal(clone.attributeAt(0)?.sourceSpan, null);
  const clonedText = clone.childAt(0);
  assert.equal(clonedText?.kind, "text");
  assert.notEqual(clonedText, successful.text);
  assert.equal(clonedText.data, "new");
  assert.equal(clonedText.sourceSpan, null);
  assert.equal(successful.previous.parent, null);

  const constrained = scenario(7);
  assert.throws(
    () => constrained.model.replaceChildrenWithClones(
      constrained.source,
      constrained.destination
    ),
    (error) => error instanceof EngineResourceLimitError &&
      error.resource === "maxNodes" && error.actual === 8
  );
  assert.equal(constrained.destination.childAt(0), constrained.previous);
  assert.equal(constrained.previous.parent, constrained.destination);
  assert.equal(constrained.source.childAt(0), constrained.nested);
});

void test("clone replacement is structurally complete before observer delivery", () => {
  const callbackFailure = new RangeError("replacement observer stopped");
  let armed = false;
  const model = new HtmlTreeModel({
    rootKind: "fragment",
    resources: createEngineResourceGuard(),
    observer: {
      onTreeMutation(event) {
        if (armed && event.kind === "node-detached") throw callbackFailure;
      }
    }
  });
  const source = element(model, "option");
  const destination = element(model, "selectedcontent");
  const sourceText = model.createText("new");
  const previous = model.createText("old");
  model.append(model.root, source);
  model.append(model.root, destination);
  model.append(source, sourceText);
  model.append(destination, previous);

  armed = true;
  assert.throws(
    () => model.replaceChildrenWithClones(source, destination),
    (error) => error === callbackFailure
  );
  assert.equal(previous.parent, null);
  const clone = destination.childAt(0);
  assert.equal(clone?.kind === "text" ? clone.data : null, "new");
  assert.equal(clone?.parent, destination);
});

void test("ownership and reference checks reject cross-model mutations before tree changes", () => {
  const first = new HtmlTreeModel({ rootKind: "fragment", resources: createEngineResourceGuard() });
  const second = new HtmlTreeModel({ rootKind: "fragment", resources: createEngineResourceGuard() });
  const local = element(first, "p");
  const foreign = element(second, "p");
  first.append(first.root, local);

  assertModelError(() => { first.append(first.root, foreign); }, "TREE_MODEL_FOREIGN_NODE");
  assertModelError(() => { first.append(second.root, local); }, "TREE_MODEL_FOREIGN_PARENT");
  assertModelError(
    () => { first.insertBefore(first.root, local, foreign); },
    "TREE_MODEL_FOREIGN_NODE"
  );
  assert.equal(first.root.childAt(0), local);
  assert.equal(second.root.childCount, 0);
});

void test("attribute adoption uses expanded names and preserves first-seen order", () => {
  const model = new HtmlTreeModel({ rootKind: "fragment", resources: createEngineResourceGuard() });
  const html = element(model, "html", [
    {
      namespaceUri: null,
      prefix: null,
      localName: "lang",
      qualifiedName: "lang",
      value: "en"
    }
  ]);
  const adopted = model.adoptAttributes(html, [
    {
      namespaceUri: null,
      prefix: null,
      localName: "lang",
      qualifiedName: "lang",
      value: "discarded"
    },
    {
      namespaceUri: XML_NAMESPACE,
      prefix: "xml",
      localName: "lang",
      qualifiedName: "xml:lang",
      value: "fr"
    }
  ]);

  assert.equal(adopted, 1);
  assert.equal(html.attributeCount, 2);
  assert.equal(html.attributeAt(0)?.value, "en");
  assert.equal(html.attributeAt(1)?.qualifiedName, "xml:lang");
});

void test("element attribute limits cover initial and atomically adopted final attributes", () => {
  const countResources = createEngineResourceGuard({ limits: { maxAttributesPerElement: 1 } });
  const countModel = new HtmlTreeModel({ rootKind: "fragment", resources: countResources });
  assert.throws(
    () => element(countModel, "x", [
      { namespaceUri: null, prefix: null, localName: "a", qualifiedName: "a", value: "" },
      { namespaceUri: null, prefix: null, localName: "b", qualifiedName: "b", value: "" }
    ]),
    (error) => error instanceof EngineResourceLimitError &&
      error.resource === "maxAttributesPerElement" && error.limit === 1 && error.actual === 2
  );

  const target = element(countModel, "html", [
    { namespaceUri: null, prefix: null, localName: "a", qualifiedName: "a", value: "" }
  ]);
  assert.throws(
    () => countModel.adoptAttributes(target, [
      { namespaceUri: null, prefix: null, localName: "b", qualifiedName: "b", value: "" }
    ]),
    (error) => error instanceof EngineResourceLimitError &&
      error.resource === "maxAttributesPerElement" && error.limit === 1 && error.actual === 2
  );
  assert.equal(target.attributeCount, 1);

  const byteResources = createEngineResourceGuard({ limits: { maxAttributeUtf8BytesPerElement: 3 } });
  const byteModel = new HtmlTreeModel({ rootKind: "fragment", resources: byteResources });
  const byteTarget = element(byteModel, "html", [
    { namespaceUri: null, prefix: null, localName: "a", qualifiedName: "a", value: "x" }
  ]);
  assert.throws(
    () => byteModel.adoptAttributes(byteTarget, [
      { namespaceUri: null, prefix: null, localName: "b", qualifiedName: "b", value: "y" }
    ]),
    (error) => error instanceof EngineResourceLimitError &&
      error.resource === "maxAttributeUtf8BytesPerElement" && error.limit === 3 && error.actual === 4
  );
  assert.equal(byteTarget.attributeCount, 1);
});

void test("text insertion coalesces only at the insertion point and retains only exact spans", () => {
  const model = new HtmlTreeModel({ rootKind: "fragment", resources: createEngineResourceGuard() });
  const paragraph = element(model, "p");
  model.append(model.root, paragraph);
  const text = model.insertText(paragraph, "a", sourceSpan(0, 1));
  assert.equal(model.insertText(paragraph, "b", sourceSpan(1, 2)), text);
  assert.equal(text.data, "ab");
  assert.deepEqual(text.sourceSpan, { startUtf16Offset: 0, endUtf16Offset: 2 });

  model.insertText(paragraph, "c", sourceSpan(4, 5));
  assert.equal(text.data, "abc");
  assert.equal(text.sourceSpan, null);

  const comment = model.createComment("split");
  model.append(paragraph, comment);
  const tail = model.insertText(paragraph, "d", sourceSpan(5, 6));
  model.insertText(paragraph, "x", sourceSpan(3, 4), comment);
  assert.equal(paragraph.childAt(0), text);
  assert.equal(text.data, "abcx");
  assert.equal(paragraph.childAt(1), comment);
  assert.equal(paragraph.childAt(2), tail);
});

void test("resource failures precede node allocation and structural mutation", () => {
  const nodeResources = createEngineResourceGuard({ limits: { maxNodes: 1 } });
  const nodeModel = new HtmlTreeModel({ rootKind: "fragment", resources: nodeResources });
  assert.throws(
    () => element(nodeModel, "p"),
    (error) => error instanceof EngineResourceLimitError && error.resource === "maxNodes"
  );
  assert.equal(nodeResources.snapshot().nodes, 1);
  assert.equal(nodeModel.root.childCount, 0);

  const templateResources = createEngineResourceGuard({ limits: { maxNodes: 2 } });
  const templateModel = new HtmlTreeModel({
    rootKind: "fragment",
    resources: templateResources
  });
  assert.throws(
    () => element(templateModel, "template"),
    (error) => error instanceof EngineResourceLimitError &&
      error.resource === "maxNodes" && error.actual === 3
  );
  assert.deepEqual(templateResources.snapshot(), {
    steps: 1,
    nodes: 1,
    maxDepth: 1,
    parseErrors: 0,
    attributes: 0,
    attributeUtf8Bytes: 0
  });

  const depthResources = createEngineResourceGuard({ limits: { maxDepth: 3 } });
  const depthModel = new HtmlTreeModel({ rootKind: "fragment", resources: depthResources });
  const outer = element(depthModel, "div");
  const inner = element(depthModel, "span");
  const tooDeep = element(depthModel, "b");
  depthModel.append(depthModel.root, outer);
  depthModel.append(outer, inner);
  assert.throws(
    () => { depthModel.append(inner, tooDeep); },
    (error) => error instanceof EngineResourceLimitError && error.resource === "maxDepth"
  );
  assert.equal(tooDeep.parent, null);
  assert.equal(inner.childCount, 0);

  const shallow = element(depthModel, "i");
  depthModel.append(depthModel.root, shallow);
  assert.throws(
    () => { depthModel.append(inner, shallow); },
    (error) => error instanceof EngineResourceLimitError && error.resource === "maxDepth"
  );
  assert.equal(shallow.parent, depthModel.root);
  assert.equal(depthModel.root.childAt(1), shallow);
});

void test("step failures leave subtree reparenting and bulk moves unchanged", () => {
  function reparentScenario(maxSteps?: number) {
    const resources = createEngineResourceGuard(
      maxSteps === undefined ? {} : { limits: { maxSteps } }
    );
    const model = new HtmlTreeModel({ rootKind: "fragment", resources });
    const source = element(model, "div");
    const destination = element(model, "section");
    const child = element(model, "span");
    const leaf = model.createText("leaf");
    model.append(model.root, source);
    model.append(model.root, destination);
    model.append(source, child);
    model.append(child, leaf);
    return { resources, model, source, destination, child, leaf };
  }

  const successfulReparent = reparentScenario();
  const reparentBaseline = successfulReparent.resources.snapshot().steps;
  successfulReparent.model.append(successfulReparent.destination, successfulReparent.child);
  const reparentSteps = successfulReparent.resources.snapshot().steps - reparentBaseline;
  const failingReparent = reparentScenario(reparentBaseline + reparentSteps - 1);
  assert.throws(
    () => { failingReparent.model.append(failingReparent.destination, failingReparent.child); },
    (error) => error instanceof EngineResourceLimitError && error.resource === "maxSteps"
  );
  assert.equal(failingReparent.child.parent, failingReparent.source);
  assert.equal(failingReparent.source.childAt(0), failingReparent.child);
  assert.equal(failingReparent.destination.childCount, 0);
  assert.equal(failingReparent.leaf.parent, failingReparent.child);

  function bulkMoveScenario(maxSteps?: number) {
    const resources = createEngineResourceGuard(
      maxSteps === undefined ? {} : { limits: { maxSteps } }
    );
    const model = new HtmlTreeModel({ rootKind: "fragment", resources });
    const source = element(model, "div");
    const destination = element(model, "b");
    const first = element(model, "i");
    const nested = element(model, "em");
    const second = model.createText("tail");
    model.append(model.root, source);
    model.append(source, first);
    model.append(first, nested);
    model.append(source, second);
    return { resources, model, source, destination, first, nested, second };
  }

  const successfulBulkMove = bulkMoveScenario();
  const bulkMoveBaseline = successfulBulkMove.resources.snapshot().steps;
  successfulBulkMove.model.moveChildren(successfulBulkMove.source, successfulBulkMove.destination);
  const bulkMoveSteps = successfulBulkMove.resources.snapshot().steps - bulkMoveBaseline;
  const failingBulkMove = bulkMoveScenario(bulkMoveBaseline + bulkMoveSteps - 1);
  assert.throws(
    () => { failingBulkMove.model.moveChildren(failingBulkMove.source, failingBulkMove.destination); },
    (error) => error instanceof EngineResourceLimitError && error.resource === "maxSteps"
  );
  assert.equal(failingBulkMove.source.childCount, 2);
  assert.equal(failingBulkMove.source.childAt(0), failingBulkMove.first);
  assert.equal(failingBulkMove.source.childAt(1), failingBulkMove.second);
  assert.equal(failingBulkMove.destination.childCount, 0);
  assert.equal(failingBulkMove.first.parent, failingBulkMove.source);
  assert.equal(failingBulkMove.nested.parent, failingBulkMove.first);
});

void test("observation is synchronous, immutable, ordered, and preserves callback failures", () => {
  const events: TreeMutationObservation[] = [];
  const model = new HtmlTreeModel({
    rootKind: "fragment",
    resources: createEngineResourceGuard(),
    observer: { onTreeMutation: (event) => events.push(event) }
  });
  const parent = element(model, "p");
  model.append(model.root, parent);
  const text = model.insertText(parent, "x", sourceSpan(0, 1));
  model.insertText(parent, "y", sourceSpan(1, 2));
  model.adoptAttributes(parent, [{
    namespaceUri: null,
    prefix: null,
    localName: "id",
    qualifiedName: "id",
    value: "x"
  }]);

  assert.deepEqual(events.map(({ kind }) => kind), [
    "node-created",
    "node-created",
    "node-inserted",
    "node-created",
    "node-inserted",
    "text-coalesced",
    "attributes-adopted"
  ]);
  assert.ok(events.every(Object.isFrozen));
  const eventCount = events.length;
  model.insertBefore(parent, text, text);
  assert.equal(events.length, eventCount);

  const callbackFailure = new RangeError("observer stopped");
  assert.throws(
    () => new HtmlTreeModel({
      rootKind: "fragment",
      resources: createEngineResourceGuard(),
      observer: { onTreeMutation: () => { throw callbackFailure; } }
    }),
    (error) => error === callbackFailure
  );
});

void test("explicit-stack mutation, validation, and traversal handle 5,000 levels", () => {
  const depth = 5_000;
  const model = new HtmlTreeModel({
    rootKind: "fragment",
    resources: createEngineResourceGuard({ limits: { maxNodes: depth + 1, maxDepth: depth + 1 } })
  });
  let parent: HtmlTreeParent = model.root;
  for (let index = 0; index < depth; index += 1) {
    const namespaceUri = index % 2 === 0 ? SVG_NAMESPACE : MATHML_NAMESPACE;
    const child = model.createElement({
      namespaceUri,
      prefix: null,
      localName: "g",
      qualifiedName: "g"
    });
    model.append(parent, child);
    parent = child;
  }

  assert.deepEqual(model.validate(), {
    allocatedNodes: depth + 1,
    attachedNodes: depth + 1,
    maxDepth: depth + 1
  });
  let traversed = 0;
  let lastDepth = 0;
  for (const entry of model.walk()) {
    traversed += 1;
    lastDepth = entry.depth;
  }
  assert.equal(traversed, depth);
  assert.equal(lastDepth, depth + 1);
});
