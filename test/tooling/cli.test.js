import assert from "node:assert/strict";
import test from "node:test";

import { parseLongOptions } from "../../scripts/lib/cli.mjs";

const specification = {
  commit: { type: "string", required: true },
  source: { type: "string" },
  check: { type: "boolean", default: false }
};

test("long options support inline and separate values with explicit booleans", () => {
  assert.deepEqual(
    { ...parseLongOptions(
      ["--commit=abc", "--source", "/tmp/source", "--check"],
      specification,
      "probe"
    ) },
    { commit: "abc", source: "/tmp/source", check: true }
  );
});

test("long options reject ambiguous or unsupported input", () => {
  assert.throws(() => parseLongOptions([], specification, "probe"), /missing required option --commit/);
  assert.throws(
    () => parseLongOptions(["--commit=a", "--commit=b"], specification, "probe"),
    /duplicate option --commit/
  );
  assert.throws(
    () => parseLongOptions(["--commit"], specification, "probe"),
    /--commit requires a value/
  );
  assert.throws(
    () => parseLongOptions(["--commit=a", "--unknown=b"], specification, "probe"),
    /unsupported option --unknown/
  );
  assert.throws(
    () => parseLongOptions(["positional", "--commit=a"], specification, "probe"),
    /unsupported positional argument/
  );
});
