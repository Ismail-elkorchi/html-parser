import { readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";

import { analyzeDeclarationGraph } from "./declaration-graph.mjs";

async function declarationFiles(directoryPath) {
  const files = [];
  for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
    const entryPath = path.posix.join(directoryPath, entry.name);
    if (entry.isDirectory()) files.push(...await declarationFiles(entryPath));
    else if (entry.isFile() && entryPath.endsWith(".d.ts")) files.push(entryPath);
  }
  return files;
}

const root = "dist/mod.d.ts";
const files = (await declarationFiles("dist")).sort();
const sources = new Map(await Promise.all(files.map(async (filePath) => [
  filePath,
  await readFile(filePath, "utf8")
])));
const result = analyzeDeclarationGraph(sources, root);
if (!result.rootFound) throw new Error(`declaration pruning: missing ${root}`);
if (result.unresolved.length > 0) {
  throw new Error(`declaration pruning: unresolved ${JSON.stringify(result.unresolved)}`);
}
await Promise.all(result.unreachable.map((filePath) => unlink(filePath)));
