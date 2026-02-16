import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { nowIso, writeJson } from "./eval-primitives.mjs";

const DIST_ROOT = "dist";

function isUrlSpecifier(specifier) {
  return /^[a-zA-Z][a-zA-Z+\-.]*:/.test(specifier);
}

function isBareSpecifier(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return false;
  }
  if (isUrlSpecifier(specifier)) {
    return false;
  }
  return true;
}

function collectImportSpecifiers(source) {
  const specifiers = [];

  const staticImportPattern = /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(staticImportPattern)) {
    const specifier = match[1];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(dynamicImportPattern)) {
    const specifier = match[1];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

async function findJsFiles(rootDir) {
  const jsFilePaths = [];

  async function walk(directoryPath) {
    const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
    for (const directoryEntry of directoryEntries) {
      const fullPath = path.join(directoryPath, directoryEntry.name);
      if (directoryEntry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (directoryEntry.isFile() && fullPath.endsWith(".js")) {
        jsFilePaths.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return jsFilePaths;
}

async function main() {
  let isCheckPass = true;
  let diagnostics = null;
  const offenders = [];

  try {
    const files = await findJsFiles(DIST_ROOT);

    for (const filePath of files) {
      const text = await readFile(filePath, "utf8");
      const specifiers = collectImportSpecifiers(text);
      for (const specifier of specifiers) {
        if (!isBareSpecifier(specifier)) {
          continue;
        }

        offenders.push({
          file: filePath.replaceAll(path.sep, "/"),
          specifier
        });
      }
    }

    isCheckPass = offenders.length === 0;
    if (!isCheckPass) {
      diagnostics = `Found ${String(offenders.length)} bare package import specifier(s) in dist`;
    }
  } catch (error) {
    isCheckPass = false;
    diagnostics = error instanceof Error ? error.message : String(error);
  }

  await writeJson("reports/no-external-imports.json", {
    suite: "no-external-imports",
    timestamp: nowIso(),
    ok: isCheckPass,
    offenders,
    ...(diagnostics ? { diagnostics } : {})
  });

  if (!isCheckPass) {
    console.error("EVAL: External runtime import check failed. See reports/no-external-imports.json");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("EVAL:", error);
  process.exit(1);
});
