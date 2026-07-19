import { readFile, writeFile } from "node:fs/promises";

import {
  GENERATED_PATH,
  readAndVerifySnapshot,
  renderGeneratedTable,
  sha256
} from "./named-character-reference-data.mjs";

const allowedArguments = new Set(["--check"]);
for (const argument of process.argv.slice(2)) {
  if (!allowedArguments.has(argument)) {
    throw new Error(`generate named character references: unsupported argument ${argument}`);
  }
}

const checkOnly = process.argv.includes("--check");
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
