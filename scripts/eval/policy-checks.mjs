import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const srcRoot = path.join(projectRoot, "src");
const builtinSet = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

const importPattern = /(?:import|export)\\s+(?:[^"'`]*?from\\s*)?["']([^"']+)["']|import\\(\\s*["']([^"']+)["']\\s*\\)/g;

async function listSourceTypeScriptFiles(directoryPath) {
  const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  const sourceFilePaths = [];

  for (const directoryEntry of directoryEntries) {
    const fullPath = path.join(directoryPath, directoryEntry.name);
    if (directoryEntry.isDirectory()) {
      sourceFilePaths.push(...(await listSourceTypeScriptFiles(fullPath)));
      continue;
    }
    if (directoryEntry.name.endsWith(".ts")) {
      sourceFilePaths.push(fullPath);
    }
  }

  return sourceFilePaths;
}

export async function runPolicyChecks(mode) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

  if (packageJson.type !== "module") {
    throw new Error("package.json must set \"type\" to \"module\".");
  }

  const dependencyNames = Object.keys(packageJson.dependencies ?? {});
  if (dependencyNames.length > 0) {
    throw new Error(`Runtime dependencies are not allowed: ${dependencyNames.join(", ")}`);
  }

  const sourceTypeScriptFiles = await listSourceTypeScriptFiles(srcRoot);
  const violations = [];

  for (const filePath of sourceTypeScriptFiles) {
    const source = await readFile(filePath, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) {
        continue;
      }
      if (builtinSet.has(specifier)) {
        violations.push(`${path.relative(projectRoot, filePath)} -> ${specifier}`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Node builtins are forbidden in src/: ${violations.join("; ")}`);
  }

  if (mode === "release") {
    const requiredFiles = [
      ".github/dependabot.yml",
      ".github/workflows/scorecards.yml",
      "docs/linting.md",
      "docs/typescript.md"
    ];

    for (const relativePath of requiredFiles) {
      const filePath = path.join(projectRoot, relativePath);
      await readFile(filePath, "utf8");
    }
  }
}
