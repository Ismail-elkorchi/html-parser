import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  GENERATED_PATH,
  inspectEntities,
  readAndVerifySnapshot,
  renderGeneratedTable,
  sha256
} from "../../scripts/generate/named-character-reference-data.mjs";

void test("named character reference snapshot and generated output verify offline", async () => {
  const { entitiesBytes, inspection } = await readAndVerifySnapshot();
  const generated = renderGeneratedTable(inspection, sha256(entitiesBytes));
  assert.equal(await readFile(GENERATED_PATH, "utf8"), generated);
});

void test("named character reference schema validation rejects controlled mutations", async () => {
  const { entitiesBytes } = await readAndVerifySnapshot();
  const mutated = JSON.parse(entitiesBytes.toString("utf8"));
  mutated["&AElig"].characters = "X";
  assert.throws(
    () => inspectEntities(Buffer.from(`${JSON.stringify(mutated)}\n`, "utf8")),
    /characters do not match codepoints/
  );

  assert.throws(
    () => inspectEntities(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])),
    /not valid UTF-8 JSON/
  );
});
