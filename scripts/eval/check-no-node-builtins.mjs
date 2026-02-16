import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { builtinModules } from "node:module";
import { nowIso, writeJson } from "./util.mjs";

const SRC_DIR = "src";

// Create a set of builtin names including both `fs` and `node:fs`
const BUILTINS = new Set(
  builtinModules.flatMap((moduleName) =>
    (moduleName.startsWith("node:")
      ? [moduleName, moduleName.slice(5)]
      : [moduleName, `node:${moduleName}`]))
);

async function listFiles(dir) {
  const collectedPaths = [];
  async function walk(pathEntry) {
    const pathStats = await stat(pathEntry);
    if (pathStats.isDirectory()) {
      const directoryEntries = await readdir(pathEntry);
      for (const directoryEntry of directoryEntries) await walk(join(pathEntry, directoryEntry));
      return;
    }
    if (pathStats.isFile() && (pathEntry.endsWith(".ts") || pathEntry.endsWith(".mts") || pathEntry.endsWith(".tsx"))) {
      collectedPaths.push(pathEntry);
    }
  }
  await walk(dir);
  return collectedPaths;
}

function extractImportSpecifiers(text) {
  const importSpecifiers = [];
  const importFromPattern = /\bimport\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g;
  const sideEffectImportPattern = /\bimport\s+['"]([^'"]+)['"]/g;
  let regexMatch;
  while ((regexMatch = importFromPattern.exec(text))) importSpecifiers.push(regexMatch[1]);
  while ((regexMatch = sideEffectImportPattern.exec(text))) importSpecifiers.push(regexMatch[1]);
  return importSpecifiers;
}

async function main() {
  const findings = [];

  let files = [];
  try {
    files = await listFiles(SRC_DIR);
  } catch {
    const report = {
      suite: "no-node-builtins",
      timestamp: nowIso(),
      ok: false,
      reason: "src/ directory not found",
      findings: []
    };
    await writeJson("reports/no-node-builtins.json", report);
    process.exit(1);
  }

  for (const file of files) {
    const text = await readFile(file, "utf8");

    if (/\brequire\s*\(/.test(text)) {
      findings.push({ file, kind: "require", message: "require(...) found in src runtime code" });
    }

    const importSpecifiers = extractImportSpecifiers(text);
    for (const importSpecifier of importSpecifiers) {
      if (BUILTINS.has(importSpecifier)) {
        findings.push({
          file,
          kind: "builtin-import",
          specifier: importSpecifier,
          message: "Node builtin import found in src runtime code"
        });
      }
    }
  }

  const ok = findings.length === 0;
  const report = {
    suite: "no-node-builtins",
    timestamp: nowIso(),
    ok,
    checkedFiles: files.length,
    findings
  };

  await writeJson("reports/no-node-builtins.json", report);

  if (!ok) {
    console.error("EVAL: Node builtin usage detected in src/:", findings);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
