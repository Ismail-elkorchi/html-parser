import assert from "node:assert/strict";
import test from "node:test";

import {
  HTML_NAMESPACE_URI,
  findById,
  getAttributeValue,
  parse,
  parseBytes,
  parseFragment,
  parseStream,
  walkElements
} from "../../dist/mod.js";

function namedAssociations(parsed) {
  return parsed.formAssociations.map(({ elementId, formId }) => {
    const element = findById(parsed.tree, elementId);
    const form = findById(parsed.tree, formId);
    assert.equal(element?.kind, "element");
    assert.equal(element.namespaceUri, HTML_NAMESPACE_URI);
    assert.equal(form?.kind, "element");
    assert.equal(form.namespaceUri, HTML_NAMESPACE_URI);
    assert.equal(form.localName, "form");
    return [getAttributeValue(element, "data-key"), getAttributeValue(form, "data-key")];
  });
}

const CASES = [
  {
    name: "duplicate IDs use pre-order even when the first form contains the later match",
    html: "<input data-key=before form=f><form id=f data-key=f><div id=f></div><input data-key=inside form=f></form><div id=g></div><form id=g></form><input data-key=blocked form=g>",
    expected: [["before", "f"], ["inside", "f"]]
  },
  {
    name: "adoption-agency reparenting clears separated non-ancestor parser owners",
    html: "<table><form data-key=f><b><p><input data-key=i></b></p></table>",
    expected: []
  },
  {
    name: "ordinary closing tags preserve the same parser association without reparenting",
    html: "<table><form data-key=f><b><p><input data-key=i></p></b></table>",
    expected: [["i", "f"]]
  },
  {
    name: "ordinary native association categories exclude arbitrary descendants",
    html: "<form data-key=f><fieldset data-key=field><input data-key=i><button data-key=b></button><select data-key=s><option></select><textarea data-key=t></textarea><output data-key=o></output><object data-key=obj></object><img data-key=img form=missing><div form=f data-key=d></div><x-control data-key=x></x-control></fieldset></form>",
    expected: [["field", "f"], ["i", "f"], ["b", "f"], ["s", "f"], ["t", "f"], ["o", "f"], ["obj", "f"], ["img", "f"]]
  },
  {
    name: "repaired table retains a non-ancestor owner and its live parser pointer",
    html: "<table><form id=f data-key=f><tr><td><input data-key=i></td></tr></table><input data-key=after>",
    expected: [["i", "f"], ["after", "f"]]
  },
  {
    name: "an ignored table end form still clears the parser pointer",
    html: "<table><form data-key=f><tr><td><input data-key=i></td></tr></form></table><input data-key=after>",
    expected: [["i", "f"]]
  },
  {
    name: "fostered controls retain the owner while relation order follows tree order",
    html: "<table><form data-key=f><input data-key=first><tr><td><input data-key=second></table>",
    expected: [["first", "f"], ["second", "f"]]
  },
  {
    name: "explicit missing, empty and non-form targets suppress connected ancestry",
    html: "<div id=x></div><form id=f data-key=f><input data-key=missing form=missing><input data-key=empty form=''><input data-key=nonform form=x><input data-key=normal></form>",
    expected: [["normal", "f"]]
  },
  {
    name: "forward explicit references override ancestry and decode character references",
    html: "<form data-key=outer><input data-key=i form='f&amp;x'></form><form id='f&amp;x' data-key=target></form><input data-key=after form='f&amp;x'>",
    expected: [["i", "target"], ["after", "target"]]
  },
  {
    name: "duplicate IDs choose the first matching element, including foreign elements",
    html: "<svg><g id=f></g></svg><form id=f data-key=second><input form=f data-key=none></form><form id=g data-key=first></form><form id=g data-key=later></form><input form=g data-key=i>",
    expected: [["i", "first"]]
  },
  {
    name: "IDs match exactly and empty IDs cannot own form-empty controls",
    html: "<form id='' data-key=empty></form><form id=Case data-key=f></form><input form='' data-key=a><input form=case data-key=b><input form=Case data-key=c>",
    expected: [["c", "f"]]
  },
  {
    name: "template trees isolate IDs and use their own ancestry without outer parser pointers",
    html: "<form id=outer data-key=outer><template><input data-key=isolated><form id=f data-key=inside><input data-key=in form=outer><template><input data-key=nested></template></form></template><input data-key=out></form><input data-key=missing form=f>",
    expected: [["in", "inside"], ["out", "outer"]]
  },
  {
    name: "template IDs cannot shadow connected form IDs",
    html: "<template><div id=f></div></template><form id=f data-key=f></form><input data-key=i form=f>",
    expected: [["i", "f"]]
  },
  {
    name: "detached discarded body nodes cannot leak public associations",
    html: "<form data-key=f><input type=hidden data-key=i></form><frameset><frame></frameset>",
    expected: []
  }
];

for (const fixture of CASES) {
  test(`form associations: ${fixture.name}`, async () => {
    for (const captureSpans of [false, true]) {
      const parsed = parse(fixture.html, { captureSpans });
      assert.deepEqual(namedAssociations(parsed), fixture.expected);
      assert.equal(Object.isFrozen(parsed.formAssociations), true);
      for (const association of parsed.formAssociations) {
        assert.equal(Object.isFrozen(association), true);
        assert.deepEqual(Object.keys(association), ["elementId", "formId"]);
      }
      assert.deepEqual(namedAssociations(globalThis.structuredClone(parsed)), fixture.expected);
      assert.deepEqual(namedAssociations(JSON.parse(JSON.stringify(parsed))), fixture.expected);
      const bytes = new TextEncoder().encode(fixture.html);
      const direct = parseBytes(bytes, { captureSpans });
      assert.deepEqual(direct.formAssociations, parsed.formAssociations);
      const streamed = await parseStream(new globalThis.ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        }
      }), { captureSpans });
      assert.deepEqual(streamed.formAssociations, parsed.formAssociations);
    }
  });
}

test("deep iterative conversion projects owners with the same relation contract", () => {
  for (const depth of [120, 140, 500]) {
    const html = `<input data-key=before form=f><form id=f data-key=f>${"<div>".repeat(depth)}<input data-key=i>${"</div>".repeat(depth)}</form><input form=f data-key=after>`;
    for (const captureSpans of [false, true]) {
      const parsed = parse(html, { captureSpans });
      assert.deepEqual(namedAssociations(parsed), [["before", "f"], ["i", "f"], ["after", "f"]]);
      const all = new Set();
      walkElements(parsed.tree, (element) => { all.add(element.id); });
      assert.ok(parsed.formAssociations.every(({ elementId, formId }) => all.has(elementId) && all.has(formId)));
    }
  }
});

test("fragment relations never reference external form contexts or resolve disconnected ID links", () => {
  const context = { namespaceUri: HTML_NAMESPACE_URI, localName: "div" };
  const local = parseFragment("<form data-key=f><input data-key=i form=missing></form><input data-key=outside form=f>", context);
  assert.deepEqual(namedAssociations(local), [["i", "f"]]);
  for (const options of [{ hasFormAncestor: true }, {}]) {
    const fragment = parseFragment("<input data-key=i>", {
      namespaceUri: HTML_NAMESPACE_URI,
      localName: options.hasFormAncestor ? "div" : "form"
    }, options);
    assert.deepEqual(fragment.formAssociations, []);
  }
  const repaired = parseFragment("<form data-key=f><tr><td><input data-key=i></table><input data-key=after>", {
    namespaceUri: HTML_NAMESPACE_URI, localName: "table"
  });
  assert.deepEqual(namedAssociations(repaired), [["i", "f"], ["after", "f"]]);
});
