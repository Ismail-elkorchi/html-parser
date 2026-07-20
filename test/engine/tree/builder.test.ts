import assert from "node:assert/strict";
import test from "node:test";

import {
  HTML_NAMESPACE,
  MATHML_NAMESPACE,
  SVG_NAMESPACE,
  XLINK_NAMESPACE,
  EngineConfigurationError,
  EngineResourceLimitError,
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

  const duplicateContextAttribute = {
    namespaceUri: null,
    prefix: null,
    localName: "encoding",
    qualifiedName: "encoding",
    value: "text/html"
  } as const;
  assert.throws(
    () => runHtmlEngine({
      inputChunks: ["<p>x"],
      parser: {
        kind: "fragment",
        scriptingMode: "disabled",
        context: {
          namespaceUri: MATHML_NAMESPACE,
          localName: "annotation-xml",
          attributes: [duplicateContextAttribute, duplicateContextAttribute]
        }
      }
    }),
    (error) => error instanceof EngineConfigurationError &&
      error.option === "options.parser.context.attributes[1]"
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

void test("foreign content is built in place with adjusted names, namespaces, and integration points", () => {
  const result = runHtmlEngine({
    inputChunks: ["<svg viewbox='0 0 1 1'><lineargradient xlink:href='#x'/><foreignObject><p>x</p></foreignObject></svg><math definitionurl='u'><mi><b>y</b></mi></math>"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const elements = [...result.model.walk()]
    .map(({ node }) => node)
    .filter((node): node is HtmlTreeElement => node.kind === "element");
  const svg = elements.find((element) => element.namespaceUri === SVG_NAMESPACE && element.localName === "svg");
  const gradient = elements.find((element) => element.localName === "linearGradient");
  const paragraph = elements.find((element) => element.localName === "p");
  const math = elements.find((element) => element.namespaceUri === MATHML_NAMESPACE && element.localName === "math");
  assert.ok(svg && gradient && paragraph && math);
  assert.equal(svg.attributeAt(0)?.localName, "viewBox");
  assert.equal(gradient.attributeAt(0)?.namespaceUri, XLINK_NAMESPACE);
  assert.equal(paragraph.namespaceUri, HTML_NAMESPACE);
  assert.equal(math.attributeAt(0)?.localName, "definitionURL");
});

void test("fragment parsing targets the fragment and respects HTML and foreign contexts", () => {
  const html = runHtmlEngine({
    inputChunks: ["<b>x</b>"],
    parser: {
      kind: "fragment",
      scriptingMode: "inert",
      context: { namespaceUri: HTML_NAMESPACE, localName: "div", attributes: [] }
    }
  });
  assert.equal(html.model.root.kind, "fragment");
  const htmlChild = html.model.root.childAt(0);
  assert.equal(htmlChild?.kind === "element" ? htmlChild.localName : null, "b");

  const svg = runHtmlEngine({
    inputChunks: ["<![CDATA[x]]><foreignObject><p>y</p></foreignObject>"],
    parser: {
      kind: "fragment",
      scriptingMode: "disabled",
      context: { namespaceUri: SVG_NAMESPACE, localName: "svg", attributes: [] }
    }
  });
  assert.deepEqual(
    [...svg.model.walk()].map(({ node }) =>
      node.kind === "element" ? [node.namespaceUri, node.localName] : [node.kind]
    ),
    [["text"], [SVG_NAMESPACE, "foreignObject"], [HTML_NAMESPACE, "p"], ["text"]]
  );

  const annotationXml = runHtmlEngine({
    inputChunks: ["<p>x</p>"],
    parser: {
      kind: "fragment",
      scriptingMode: "disabled",
      context: {
        namespaceUri: MATHML_NAMESPACE,
        localName: "annotation-xml",
        attributes: [{
          namespaceUri: null,
          prefix: null,
          localName: "encoding",
          qualifiedName: "encoding",
          value: "APPLICATION/XHTML+XML"
        }]
      }
    }
  });
  const annotationChild = annotationXml.model.root.childAt(0);
  assert.equal(annotationChild?.kind === "element" ? annotationChild.namespaceUri : null, HTML_NAMESPACE);
});

void test("table construction synthesizes containers and foster-parents text during token handling", () => {
  const result = runHtmlEngine({
    inputChunks: ["<!doctype html><p>lead<table>x<tr><td><b>cell</table>tail"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const elements = [...result.model.walk()]
    .map(({ node }) => node)
    .filter((node): node is HtmlTreeElement => node.kind === "element");
  const body = elements.find((element) => element.localName === "body");
  const table = elements.find((element) => element.localName === "table");
  const cell = elements.find((element) => element.localName === "td");
  assert.ok(body && table && cell);
  assert.deepEqual(children(body).map((node) =>
    node.kind === "element" ? node.localName : node.kind === "text" ? node.data : node.kind
  ), ["p", "x", "table", "tail"]);
  assert.equal(table.parent, body);
  assert.equal(cell.parent?.kind === "element" ? cell.parent.localName : null, "tr");
  const cellChild = cell.childAt(0);
  assert.equal(cellChild?.kind === "element" ? cellChild.localName : null, "b");
  assert.ok(result.parseErrors.some((error) =>
    error.phase === "tree-builder" && error.insertionMode === "in-table-text"
  ));
});

void test("templates own their contents and clean up every parser stack on close", () => {
  const result = runHtmlEngine({
    inputChunks: ["<!doctype html><body data=kept><template><body data=ignored><table><tr><td>x</template><p>y"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const elements = [...result.model.walk()]
    .map(({ node }) => node)
    .filter((node): node is HtmlTreeElement => node.kind === "element");
  const body = elements.find((element) => element.localName === "body");
  const template = elements.find((element) => element.localName === "template");
  assert.ok(body && template?.templateContents);
  assert.equal(body.attributeAt(0)?.qualifiedName, "data");
  assert.equal(body.attributeAt(0)?.value, "kept");
  const templateChild = template.templateContents.childAt(0);
  const bodyChild = children(body).at(-1);
  assert.equal(templateChild?.kind === "element" ? templateChild.localName : null, "table");
  assert.equal(bodyChild?.kind === "element" ? bodyChild.localName : null, "p");
  assert.deepEqual(result.state.templateInsertionModes, []);
  assert.equal(result.state.insertionMode, "in-body");

  const thorough = runHtmlEngine({
    inputChunks: ["<!doctype html><template><td>x</template>"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  assert.equal(thorough.parseErrors.length, 0);

  const ignoredColumnText = runHtmlEngine({
    inputChunks: ["<!doctype html><template><col>Hello</template>"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  assert.equal(ignoredColumnText.parseErrors.length, 5);
  assert.equal([...ignoredColumnText.model.walk()].some(({ node }) =>
    node.kind === "text" && node.data.includes("Hello")
  ), false);
});

void test("relaxed select parsing uses in-body rules without resurrecting removed insertion modes", () => {
  const transitions: InsertionModeTransition[] = [];
  const result = runHtmlEngine({
    inputChunks: ["<!doctype html><select><div>x<option>a<select><option>b"],
    parser: { kind: "document", scriptingMode: "disabled" },
    observer: { onInsertionModeTransition(transition) { transitions.push(transition); } }
  });
  const elements = [...result.model.walk()]
    .map(({ node }) => node)
    .filter((node): node is HtmlTreeElement => node.kind === "element");
  const select = elements.find((element) => element.localName === "select");
  const options = elements.filter((element) => element.localName === "option");
  assert.ok(select);
  const selectChild = select.childAt(0);
  assert.equal(selectChild?.kind === "element" ? selectChild.localName : null, "div");
  assert.equal(options.length, 2);
  assert.equal(options[0]?.parent?.kind === "element" ? options[0].parent.localName : null, "div");
  assert.equal(options[1]?.parent?.kind === "element" ? options[1].parent.localName : null, "body");
  assert.equal(transitions.some(({ to }) => to.includes("select")), false);
});

void test("frameset construction reaches its trailing document mode without an implied body", () => {
  const result = runHtmlEngine({
    inputChunks: ["<!doctype html><frameset cols=*><frame src=x></frameset></html>"],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const elements = [...result.model.walk()]
    .map(({ node }) => node)
    .filter((node): node is HtmlTreeElement => node.kind === "element");
  const frameset = elements.find((element) => element.localName === "frameset");
  assert.ok(frameset);
  const frame = frameset.childAt(0);
  assert.equal(frame?.kind === "element" ? frame.localName : null, "frame");
  assert.equal(elements.some((element) => element.localName === "body"), false);
  assert.equal(result.state.insertionMode, "after-after-frameset");
});

void test("contextual tree construction is invariant across adversarial chunk boundaries", () => {
  for (const input of [
    "<!doctype html><table>alpha<tr><td><b>cell</table>omega",
    "<!doctype html><template><table><tr><td>x</template><p>y",
    "<!doctype html><select><div>x<option>a<select><option>b",
    "<!doctype html><frameset><frame></frameset></html>"
  ]) {
    const run = (inputChunks: readonly string[]) => {
      const mutations: TreeMutationObservation[] = [];
      const transitions: InsertionModeTransition[] = [];
      const result = runHtmlEngine({
        inputChunks,
        parser: { kind: "document", scriptingMode: "disabled" },
        observer: {
          onInsertionModeTransition(transition) { transitions.push(transition); },
          onTreeMutation(mutation) { mutations.push(mutation); }
        }
      });
      return { result, mutations, transitions };
    };
    const whole = run([input]);
    const chunked = run(input.split(""));
    assert.deepEqual(treeShape(chunked.result.model), treeShape(whole.result.model));
    assert.deepEqual(chunked.result.parseErrors, whole.result.parseErrors);
    assert.deepEqual(
      { ...chunked.result.resources, steps: 0 },
      { ...whole.result.resources, steps: 0 }
    );
    assert.deepEqual(chunked.mutations, whole.mutations);
    assert.deepEqual(chunked.transitions, whole.transitions);
  }
});

void test("contextual tree construction fails on the first unavailable resource unit", () => {
  const input = `<!doctype html><template><table>${"x".repeat(200)}<tr><td>y</template>`;
  const baseline = runHtmlEngine({
    inputChunks: [input],
    parser: { kind: "document", scriptingMode: "disabled" }
  });
  const exact = runHtmlEngine({
    inputChunks: [input],
    parser: { kind: "document", scriptingMode: "disabled" },
    limits: {
      maxSteps: baseline.resources.steps,
      maxParseErrors: baseline.resources.parseErrors
    }
  });
  assert.deepEqual(treeShape(exact.model), treeShape(baseline.model));
  assert.throws(
    () => runHtmlEngine({
      inputChunks: [input],
      parser: { kind: "document", scriptingMode: "disabled" },
      limits: { maxSteps: baseline.resources.steps - 1 }
    }),
    (error) => error instanceof EngineResourceLimitError &&
      error.resource === "maxSteps" && error.actual === baseline.resources.steps
  );
  assert.throws(
    () => runHtmlEngine({
      inputChunks: [input],
      parser: { kind: "document", scriptingMode: "disabled" },
      limits: { maxParseErrors: baseline.resources.parseErrors - 1 }
    }),
    (error) => error instanceof EngineResourceLimitError &&
      error.resource === "maxParseErrors" && error.actual === baseline.resources.parseErrors
  );
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
