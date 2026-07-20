import assert from "node:assert/strict";
import test from "node:test";

import { parseFragment, serialize } from "../../dist/mod.js";

test("frameset fragment context keeps frame node after unmatched close tag", () => {
  const fragment = parseFragment("</frameset><frame>", "frameset");
  assert.equal(serialize(fragment), "<frame></frame>");
});
