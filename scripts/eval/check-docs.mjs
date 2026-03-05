import { readFile, readdir } from "node:fs/promises";

import { fileExists, nowIso, writeJson } from "./eval-primitives.mjs";

const REQUIRED_FILES = [
  "README.md",
  "docs/index.md",
  "docs/tutorial/first-parse.md",
  "docs/reference/api-overview.md",
  "docs/reference/options.md",
  "docs/reference/error-model.md",
  "docs/explanation/design-constraints.md",
  "docs/explanation/security-posture.md",
  "docs/explanation/performance-characteristics.md"
];

const REQUIRED_DOCS_ROOT = new Set([
  "index.md",
  "tutorial",
  "how-to",
  "reference",
  "explanation",
  "maintainers"
]);

const REQUIRED_README_PATTERNS = [
  { name: "When To Use", re: /##\s*When To Use/i },
  { name: "When Not To Use", re: /##\s*When Not To Use/i },
  { name: "Install", re: /##\s*Install/i },
  { name: "Import", re: /##\s*Import/i },
  { name: "Docs map", re: /docs\/index\.md/i },
  { name: "Runtime compatibility", re: /runtime\s+compatibility/i },
  { name: "Security", re: /\bsecurity\b/i },
  { name: "No runtime dependencies statement", re: /no\s+runtime\s+depend/i }
];

const API_ENTRYPOINT_PATH = "src/public/mod.ts";
const API_REFERENCE_PATH = "docs/reference/api-overview.md";

function collectRuntimeExports(entrypointSource) {
  const exports = new Set();
  for (const match of entrypointSource.matchAll(/export\s+class\s+([A-Za-z0-9_]+)/g)) {
    exports.add(match[1]);
  }
  for (const match of entrypointSource.matchAll(/export\s+(?:async\s+)?function\*?\s+([A-Za-z0-9_]+)/g)) {
    exports.add(match[1]);
  }
  return [...exports].sort((left, right) => left.localeCompare(right));
}

async function collectHowToCount() {
  const entries = await readdir("docs/how-to", { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).length;
}

async function collectDocsRootUnexpectedEntries() {
  const entries = await readdir("docs", { withFileTypes: true });
  return entries
    .map((entry) => entry.name)
    .filter((name) => !REQUIRED_DOCS_ROOT.has(name))
    .sort((left, right) => left.localeCompare(right));
}

async function main() {
  const missingFiles = [];
  for (const requiredFilePath of REQUIRED_FILES) {
    if (!(await fileExists(requiredFilePath))) {
      missingFiles.push(requiredFilePath);
    }
  }

  const unexpectedDocsRootEntries = await collectDocsRootUnexpectedEntries();
  const howToCount = await collectHowToCount();

  let readme = "";
  if (await fileExists("README.md")) {
    readme = await readFile("README.md", "utf8");
  }

  const missingReadmeSections = [];
  for (const { name: sectionName, re: sectionPattern } of REQUIRED_README_PATTERNS) {
    if (!sectionPattern.test(readme)) {
      missingReadmeSections.push(sectionName);
    }
  }

  let missingApiReferenceEntries = [];
  if (await fileExists(API_ENTRYPOINT_PATH) && await fileExists(API_REFERENCE_PATH)) {
    const [entrypointSource, apiReference] = await Promise.all([
      readFile(API_ENTRYPOINT_PATH, "utf8"),
      readFile(API_REFERENCE_PATH, "utf8")
    ]);
    const runtimeExports = collectRuntimeExports(entrypointSource);
    missingApiReferenceEntries = runtimeExports.filter((name) => {
      const symbolPattern = new RegExp(`\\\`${name}(?:[^\\\`]*)\\\``);
      return !symbolPattern.test(apiReference);
    });
  } else {
    missingApiReferenceEntries = ["api-reference-check-input-missing"];
  }

  const docsLayoutOk = unexpectedDocsRootEntries.length === 0;
  const hasEnoughHowToGuides = howToCount >= 4;
  const isDocsCheckPass =
    missingFiles.length === 0 &&
    missingReadmeSections.length === 0 &&
    missingApiReferenceEntries.length === 0 &&
    docsLayoutOk &&
    hasEnoughHowToGuides;

  const report = {
    suite: "docs",
    timestamp: nowIso(),
    ok: isDocsCheckPass,
    missingFiles,
    missingReadmeSections,
    missingApiReferenceEntries,
    docsLayoutOk,
    unexpectedDocsRootEntries,
    howToCount,
    hasEnoughHowToGuides
  };

  await writeJson("reports/docs.json", report);

  if (!isDocsCheckPass) {
    console.error("Docs check failed:", report);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
