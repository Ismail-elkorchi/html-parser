import assert from "node:assert/strict";
import test from "node:test";

import {
  HtmlConfigurationError,
  serialize
} from "../../dist/mod.js";
import {
  PUBLIC_SERIALIZER_CASES,
  runPublicSerializerCase
} from "../support/public-serializer-cases.mjs";

for (const testCase of PUBLIC_SERIALIZER_CASES) {
  test(`public serializer: ${testCase.id}`, () => {
    assert.equal(runPublicSerializerCase(testCase), testCase.expected);
  });
}

test("public serializer validates the scripting environment", () => {
  assert.throws(
    () => serialize(PUBLIC_SERIALIZER_CASES[0].input(), { scriptingMode: "enabled" }),
    (error) => error instanceof HtmlConfigurationError &&
      error.option === "options.scriptingMode" && error.reason === "INVALID_VALUE"
  );
});
