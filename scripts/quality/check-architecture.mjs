import { readFile, readdir } from "node:fs/promises";

import { analyzeSourceGraph } from "./source-graph.mjs";

async function sourceFiles(directoryPath) {
  const files = [];
  for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
    const entryPath = `${directoryPath}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await sourceFiles(entryPath));
    else if (entry.isFile() && entryPath.endsWith(".ts")) files.push(entryPath);
  }
  return files;
}

const files = (await sourceFiles("src")).sort();
const sources = await Promise.all(files.map(async (filePath) => ({
  filePath,
  source: await readFile(filePath, "utf8")
})));
const result = analyzeSourceGraph(sources);

if (result.unresolved.length > 0) {
  throw new Error(`architecture: unresolved source imports ${JSON.stringify(result.unresolved)}`);
}
if (result.externalReferences.length > 0) {
  throw new Error(`architecture: external runtime imports ${JSON.stringify(result.externalReferences)}`);
}
if (result.commonJsReferences.length > 0) {
  throw new Error(`architecture: CommonJS imports ${JSON.stringify(result.commonJsReferences)}`);
}
if (result.cycles.length > 0) {
  throw new Error(`architecture: source cycles ${JSON.stringify(result.cycles)}`);
}
if (!result.entrypointFound || result.unreachableFromEntrypoint.length > 0) {
  throw new Error(
    `architecture: source outside the package graph ${JSON.stringify(result.unreachableFromEntrypoint)}`
  );
}
if (result.layerViolations.length > 0) {
  throw new Error(`architecture: dependency direction ${JSON.stringify(result.layerViolations)}`);
}

const expectedEngineImporters = new Set(["src/public/parsing.ts"]);
const unexpectedEngineIngress = result.engineIngress.filter(
  ({ filePath }) => !expectedEngineImporters.has(filePath)
);
if (unexpectedEngineIngress.length > 0) {
  throw new Error(`architecture: unexpected engine ingress ${JSON.stringify(unexpectedEngineIngress)}`);
}
if (!result.engineIngress.some(({ filePath }) => filePath === "src/public/parsing.ts")) {
  throw new Error("architecture: public parsing owner no longer reaches the engine");
}

const expectedGeneratedIngress = [{
  filePath: "src/internal/html-engine/named-character-references.ts",
  dependency: "src/internal/html-engine/generated/named-character-references.ts"
}];
if (JSON.stringify(result.generatedIngress) !== JSON.stringify(expectedGeneratedIngress)) {
  throw new Error(`architecture: generated-data ingress ${JSON.stringify(result.generatedIngress)}`);
}

process.stdout.write(
  `architecture: ${String(result.files)} source files, ${String(result.edges)} edges, ` +
    "no dead modules or cycles, exact layers and private ingress\n"
);
