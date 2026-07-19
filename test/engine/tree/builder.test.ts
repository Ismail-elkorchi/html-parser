import assert from "node:assert/strict";
import test from "node:test";

import {
  HTML_NAMESPACE,
  EngineConfigurationError,
  EngineResourceLimitError,
  HtmlTreeBuilderPendingFeatureError,
  runHtmlEngine,
  type EngineObserver,
  type HtmlTreeElement,
  type HtmlTreeNode,
  type HtmlTreeModel,
  type HtmlTreeParent,
  type InsertionModeTransition,
  type TreeMutationObservation
} from "../../../src/internal/html-engine/mod.js";

function children(parent: HtmlTreeParent): readonly HtmlTreeNode[] {
  const result: HtmlTreeNode[] = [];
  for (let index = 0; index < parent.childCount; index += 1) {
    const child = parent.childAt(index);
    if (child !== null) result.push(child);
  }
  return result;
}

function treeShape(model: HtmlTreeModel): unknown {
  function nodeShape(node: HtmlTreeNode): unknown {
    if (node.kind === "text" || node.kind === "comment") {
      return { kind: node.kind, data: node.data };
    }
    if (node.kind === "processing-instruction") {
      return { kind: node.kind, target: node.target, data: node.data };
    }
    if (node.kind === "doctype") {
      return { kind: node.kind, name: node.name, externalId: node.externalId };
    }
    return {
      kind: "element",
      namespaceUri: node.namespaceUri,
      localName: node.localName,
      attributes: Array.from({ length: node.attributeCount }, (_, index) => node.attributeAt(index)),
      children: children(node.templateContents ?? node).map(nodeShape)
    };
  }
  return children(model.root).map(nodeShape);
}

void test("document driver constructs one direct tree and retains processing instructions", () => {
  const result = runHtmlEngine({
    inputChunks: ["<?prolog data?><!doctype html><html lang=en><head><title>A&amp;B</title>",
      "</head><body><p>x<div>y</div>z"],
    parser: { kind: "document", scriptingMode: "inert" }
  });

  assert.equal(result.state.documentMode, "no-quirks");
  assert.equal(result.state.insertionMode, "in-body");
  assert.deepEqual(treeShape(result.model), [
    { kind: "processing-instruction", target: "prolog", data: "data" },
    { kind: "doctype", name: "html", externalId: { kind: "none" } },
    {
      kind: "element",
      namespaceUri: HTML_NAMESPACE,
      localName: "html",
      attributes: [{
        namespaceUri: null,
        prefix: null,
        localName: "lang",
        qualifiedName: "lang",
        value: "en",
        sourceSpan: { startUtf16Offset: 36, endUtf16Offset: 43 }
      }],
      children: [
        {
          kind: "element",
          namespaceUri: HTML_NAMESPACE,
          localName: "head",
          attributes: [],
          children: [{
            kind: "element",
            namespaceUri: HTML_NAMESPACE,
            localName: "title",
            attributes: [],
            children: [{ kind: "text", data: "A&B" }]
          }]
        },
        {
          kind: "element",
          namespaceUri: HTML_NAMESPACE,
          localName: "body",
          attributes: [],
          children: [
            {
              kind: "element",
              namespaceUri: HTML_NAMESPACE,
              localName: "p",
              attributes: [],
              children: [{ kind: "text", data: "x" }]
            },
            {
              kind: "element",
              namespaceUri: HTML_NAMESPACE,
              localName: "div",
              attributes: [],
              children: [{ kind: "text", data: "y" }]
            },
            { kind: "text", data: "z" }
          ]
        }
      ]
    }
  ]);
  assert.deepEqual(result.model.validate(), {
    allocatedNodes: result.resources.nodes,
    attachedNodes: result.resources.nodes,
    maxDepth: result.resources.maxDepth
  });
});

void test("token feedback, insertion transitions, and mutations are synchronous and deterministic", () => {
  const events: string[] = [];
  const transitions: InsertionModeTransition[] = [];
  const mutations: TreeMutationObservation[] = [];
  const observer: EngineObserver = {
    onToken(token) { events.push(`token:${token.kind}`); },
    onInsertionModeTransition(transition) {
      transitions.push(transition);
      events.push(`mode:${transition.from}->${transition.to}`);
    },
    onTreeMutation(mutation) {
      mutations.push(mutation);
      events.push(`mutation:${mutation.kind}`);
    }
  };
  const input = "<title>x</title><p>y<br/>z";
  const whole = runHtmlEngine({
    inputChunks: [input],
    parser: { kind: "document", scriptingMode: "disabled" },
    observer
  });
  const chunked = runHtmlEngine({
    inputChunks: input.split(""),
    parser: { kind: "document", scriptingMode: "disabled" }
  });

  assert.deepEqual(treeShape(chunked.model), treeShape(whole.model));
  assert.deepEqual(chunked.parseErrors, whole.parseErrors);
  assert.deepEqual(
    { ...chunked.resources, steps: 0 },
    { ...whole.resources, steps: 0 }
  );
  assert.ok(transitions.some(({ from, to }) => from === "in-head" && to === "text"));
  assert.ok(transitions.some(({ from, to }) => from === "text" && to === "in-head"));
  assert.ok(mutations.length > 0);
  assert.ok(events.indexOf("mode:in-head->text") > events.indexOf("token:start-tag"));
  assert.deepEqual(whole.parseErrors.map((error) => error.phase), ["tree-builder"]);
});

void test("RCDATA feedback is applied before title markup reaches the tokenizer", () => {
  const result = runHtmlEngine({
    inputChunks: ["<title>a<b>c</title>"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const title = [...result.model.walk()]
    .map(({ node }) => node)
    .find((node) => node.kind === "element" && node.localName === "title");
  assert.equal(title?.kind, "element");
  const child = title.childAt(0);
  assert.equal(child?.kind, "text");
  assert.equal(child.data, "a<b>c");
});

void test("scripting mode controls head noscript tokenization without executing scripts", () => {
  const disabled = runHtmlEngine({
    inputChunks: ["<head><noscript><meta name=x></noscript><body>ok"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const inert = runHtmlEngine({
    inputChunks: ["<head><noscript><meta name=x></noscript><body>ok"],
    parser: { kind: "document", scriptingMode: "inert" }
  });
  assert.notDeepEqual(treeShape(disabled.model), treeShape(inert.model));
});

void test("driver configuration and resource limits fail before unavailable work", () => {
  const runUnknown = runHtmlEngine as (options: unknown) => unknown;
  assert.throws(
    () => runUnknown({ inputChunks: [], parser: { kind: "fragment", scriptingMode: "inert" } }),
    (error) => error instanceof EngineConfigurationError
  );
  const baseline = runHtmlEngine({
    inputChunks: ["<p>x"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  assert.throws(
    () => runHtmlEngine({
      inputChunks: ["<p>x"],
      parser: { kind: "document", scriptingMode: "disabled" },
      limits: { maxNodes: baseline.resources.nodes - 1 }
    }),
    (error) => error instanceof EngineResourceLimitError && error.resource === "maxNodes"
  );
});

void test("DOCTYPE modes and unnamed tree-construction diagnostics retain exact token spans", () => {
  const limited = runHtmlEngine({
    inputChunks: ['<!doctype html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">'],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  assert.equal(limited.state.documentMode, "limited-quirks");

  const quirks = runHtmlEngine({
    inputChunks: ["<!doctype potato><address>x"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  assert.equal(quirks.state.documentMode, "quirks");
  assert.deepEqual(quirks.parseErrors.filter((error) => error.phase === "tree-builder"), [
    {
      code: "unexpected-token",
      phase: "tree-builder",
      insertionMode: "initial",
      tokenKind: "doctype",
      tagName: null,
      span: { startUtf16Offset: 0, endUtf16Offset: 17 }
    },
    {
      code: "unexpected-token",
      phase: "tree-builder",
      insertionMode: "in-body",
      tokenKind: "eof",
      tagName: null,
      span: { startUtf16Offset: 27, endUtf16Offset: 27 }
    }
  ]);
});

void test("the ignored leading line feed is isolated with its original CRLF source width", () => {
  const result = runHtmlEngine({
    inputChunks: ["<!doctype html><pre>\r", "\nx</pre>"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const text = [...result.model.walk()].find(({ node }) => node.kind === "text")?.node;
  assert.equal(text?.kind, "text");
  assert.equal(text.data, "x");
  assert.deepEqual(text.sourceSpan, { startUtf16Offset: 22, endUtf16Offset: 23 });
});

void test("leading ASCII whitespace is ignored without absorbing following body text", () => {
  const result = runHtmlEngine({
    inputChunks: [" \tx"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const texts = [...result.model.walk()]
    .map(({ node }) => node)
    .filter((node) => node.kind === "text");
  assert.deepEqual(texts.map((node) => node.data), ["x"]);
  assert.deepEqual(texts[0]?.sourceSpan, { startUtf16Offset: 2, endUtf16Offset: 3 });
});

void test("later insertion-mode families fail explicitly instead of constructing a known-wrong tree", () => {
  for (const [html, feature] of [
    ["<table>", "table"],
    ["<select>", "select"],
    ["<template>", "template"],
    ["<frameset>", "frameset"],
    ["<svg>", "foreign-content"]
  ] as const) {
    assert.throws(
      () => runHtmlEngine({
        inputChunks: [html],
        parser: { kind: "document", scriptingMode: "disabled" }
      }),
      (error) =>
        error instanceof HtmlTreeBuilderPendingFeatureError && error.feature === feature
    );
  }
});

void test("active formatting is reconstructed before text is inserted after a block boundary", () => {
  const result = runHtmlEngine({
    inputChunks: ["<p><b>one<div>two</b>three"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const bolds = [...result.model.walk()]
    .map(({ node }) => node)
    .filter((node): node is HtmlTreeElement => node.kind === "element" && node.localName === "b");

  assert.equal(bolds.length, 2);
  const original = bolds[0];
  assert.ok(original);
  assert.equal(original.parent?.kind, "element");
  assert.equal(original.parent.localName, "p");
  const reconstructed = bolds[1];
  assert.ok(reconstructed);
  assert.equal(reconstructed.parent?.kind, "element");
  assert.equal(reconstructed.parent.localName, "div");
  const text = reconstructed.childAt(0);
  assert.ok(text?.kind === "text");
  assert.equal(text.data, "two");
});

void test("misnested links are repaired during token handling", () => {
  const result = runHtmlEngine({
    inputChunks: ["<a><p></a></p>"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const links = [...result.model.walk()]
    .map(({ node }) => node)
    .filter((node) => node.kind === "element" && node.localName === "a");

  assert.equal(links.length, 2);
  assert.equal(links[0]?.parent?.kind === "element" ? links[0].parent.localName : null, "body");
  assert.equal(links[1]?.parent?.kind === "element" ? links[1].parent.localName : null, "p");
});

void test("related in-body recovery rejects NUL, consumes textarea LF, and removes forms exactly", () => {
  const nul = runHtmlEngine({
    inputChunks: ["<body>\u0000x"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const nulText = [...nul.model.walk()].find(({ node }) => node.kind === "text")?.node;
  assert.equal(nulText?.kind === "text" ? nulText.data : null, "x");
  assert.equal(nul.parseErrors.length, 3);

  const textarea = runHtmlEngine({
    inputChunks: ["<!doctype html><textarea>\nfoo</textarea>"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const textareaElement = [...textarea.model.walk()]
    .map(({ node }) => node)
    .find((node): node is HtmlTreeElement => node.kind === "element" && node.localName === "textarea");
  assert.ok(textareaElement);
  const textareaText = textareaElement.childAt(0);
  assert.equal(textareaText?.kind === "text" ? textareaText.data : null, "foo");

  const form = runHtmlEngine({
    inputChunks: ["<!doctype html><form><div></form><div>"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  assert.equal(form.parseErrors.length, 2);
  assert.equal(form.state.formElement, null);
});

void test("formatting recovery trees, diagnostics, and mutations are chunk-invariant", () => {
  const input = "<p><b id=a>one<i>two<div>three</b>four</i><nobr><nobr>five";
  const run = (inputChunks: readonly string[]) => {
    const mutations: TreeMutationObservation[] = [];
    const result = runHtmlEngine({
      inputChunks,
      parser: { kind: "document", scriptingMode: "disabled" },
      observer: { onTreeMutation(mutation) { mutations.push(mutation); } }
    });
    return { result, mutations };
  };
  const whole = run([input]);
  const unitChunks = run(input.split(""));

  assert.deepEqual(treeShape(unitChunks.result.model), treeShape(whole.result.model));
  assert.deepEqual(unitChunks.result.parseErrors, whole.result.parseErrors);
  assert.deepEqual(
    { ...unitChunks.result.resources, steps: 0 },
    { ...whole.result.resources, steps: 0 }
  );
  assert.deepEqual(unitChunks.mutations, whole.mutations);
});
