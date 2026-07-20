import assert from "node:assert/strict";
import test from "node:test";

import { HTML_NAMESPACE_URI, parseFragment, serialize } from "../../dist/mod.js";

test("frameset fragment context serializes frame as a void element", () => {
  const fragment = parseFragment("</frameset><frame>", {
    namespaceUri: HTML_NAMESPACE_URI,
    localName: "frameset"
  });
  assert.equal(serialize(fragment), "<frame>");
});
