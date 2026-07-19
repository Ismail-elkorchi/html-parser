import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  runLegacyBlackBoxFixture,
  serializeCanonical
} from "../../scripts/legacy/run-black-box.mjs";

const fixture = JSON.parse(
  await readFile("test/fixtures/legacy-runtime/requests.json", "utf8")
);
const expectedText = await readFile(
  "test/fixtures/legacy-runtime/expected.json",
  "utf8"
);

test("legacy runtime black-box output, resources, errors, and traces remain frozen", async () => {
  const actual = await runLegacyBlackBoxFixture(fixture);
  assert.equal(serializeCanonical(actual), expectedText);
});
