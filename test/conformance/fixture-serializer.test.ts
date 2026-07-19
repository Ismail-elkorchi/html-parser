import assert from "node:assert/strict";
import test from "node:test";

import { serializeFixtureTokenStream } from "../support/fixture-serializer.js";

void test("fixture serializer omits trailing optional dd end tag but keeps dt end tag", () => {
  assert.equal(serializeFixtureTokenStream([["EndTag", "dd"]], {}), "");
  assert.equal(serializeFixtureTokenStream([["EndTag", "dt"]], {}), "</dt>");
});
