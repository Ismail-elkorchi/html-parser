import { readFile, writeFile } from "node:fs/promises";

import {
  GENERATED_PATH,
  readAndVerifySnapshot,
  renderGeneratedTable,
  sha256
} from "./named-character-reference-data.mjs";
import { parseLongOptions } from "../lib/cli.mjs";

const { check: checkOnly } = parseLongOptions(process.argv.slice(2), {
  check: { type: "boolean", default: false }
}, "generate named character references");
const { entitiesBytes, inspection } = await readAndVerifySnapshot();
const generated = renderGeneratedTable(inspection, sha256(entitiesBytes));

if (checkOnly) {
  const current = await readFile(GENERATED_PATH, "utf8");
  if (current !== generated) {
    throw new Error(
      `generated named character references are stale; run npm run character-references:generate`
    );
  }
  process.stdout.write(
    `named character references: ${String(inspection.entryCount)} entries verified byte-for-byte\n`
  );
} else {
  await writeFile(GENERATED_PATH, generated, "utf8");
  process.stdout.write(
    `named character references: wrote ${String(inspection.entryCount)} entries to ${GENERATED_PATH}\n`
  );
}
