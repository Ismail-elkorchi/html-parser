import { readFile, readdir } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

import { fileExists, nowIso, writeJson } from "./eval-primitives.mjs";

const REQUIRED_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "RELEASING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "THIRD_PARTY_NOTICES.md",
  "docs/index.md",
  "docs/getting-started.md",
  "docs/parsing.md",
  "docs/streams-and-encoding.md",
  "docs/querying-and-text.md",
  "docs/modifying-html.md",
  "docs/limits-errors-and-safety.md",
  "docs/data-model.md",
  "docs/api.md",
  "docs/architecture.md",
  "docs/maintainers/index.md",
  "docs/maintainers/testing.md",
  "docs/maintainers/corpora.md",
  "docs/maintainers/source-policy.md"
];

const REQUIRED_README_PATTERNS = [
  { name: "pre-1.0 compatibility policy", re: /pre-1\.0[\s\S]{0,100}breaking changes/i },
  { name: "installation", re: /##\s*Install/i },
  { name: "npm installation", re: /npm install @ismail-elkorchi\/html-parser/ },
  { name: "JSR installation", re: /deno add jsr:@ismail-elkorchi\/html-parser/ },
  { name: "quick start", re: /##\s*Quick start/i },
  { name: "documentation path", re: /docs\/index\.md/i },
  { name: "runtime support", re: /##\s*Runtime support/i },
  { name: "security boundary", re: /parsing is not sanitization|does not[^\n]*sanitize/i },
  { name: "external dependency status", re: /no external runtime packages[\s\S]{0,100}dependencies[\s\S]{0,40}empty/i },
  { name: "independent implementation status", re: /independent standards-based TypeScript implementation/i }
];

const API_ENTRYPOINT_PATH = "src/mod.ts";
const API_REFERENCE_PATH = "docs/api.md";

function collectRuntimeExports(entrypointSource) {
  const exports = new Set();
  for (const match of entrypointSource.matchAll(/export\s+class\s+([A-Za-z0-9_]+)/g)) {
    exports.add(match[1]);
  }
  for (const match of entrypointSource.matchAll(/export\s+(?:async\s+)?function\*?\s+([A-Za-z0-9_]+)/g)) {
    exports.add(match[1]);
  }
  for (const match of entrypointSource.matchAll(/export\s*\{([\s\S]*?)\}\s*from\s*["'][^"']+["']/g)) {
    for (const rawSpecifier of (match[1] ?? "").split(",")) {
      const specifier = rawSpecifier.trim();
      if (specifier.length === 0 || specifier.startsWith("type ")) continue;
      const exportedName = specifier.split(/\s+as\s+/).at(-1);
      if (exportedName) exports.add(exportedName);
    }
  }
  return [...exports].sort((left, right) => left.localeCompare(right));
}

async function collectMarkdownFiles(directoryPath) {
  const files = [];
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }
  return files;
}

function collectRelativeLinkTargets(markdown) {
  const targets = [];
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1]?.trim().replace(/^<|>$/g, "");
    if (
      !rawTarget
      || rawTarget.startsWith("#")
      || rawTarget.startsWith("/")
      || /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
    ) {
      continue;
    }
    const fileTarget = rawTarget.split("#", 1)[0]?.split("?", 1)[0];
    if (fileTarget) targets.push(fileTarget);
  }
  return targets;
}

async function collectBrokenRelativeLinks(markdownFiles) {
  const brokenLinks = [];
  for (const markdownFile of markdownFiles) {
    const markdown = await readFile(markdownFile, "utf8");
    for (const target of collectRelativeLinkTargets(markdown)) {
      let decodedTarget;
      try {
        decodedTarget = decodeURIComponent(target);
      } catch {
        brokenLinks.push({ source: markdownFile, target, reason: "invalid URI encoding" });
        continue;
      }
      const resolvedTarget = normalize(join(dirname(markdownFile), decodedTarget));
      if (!(await fileExists(resolvedTarget))) {
        brokenLinks.push({ source: markdownFile, target, resolvedTarget });
      }
    }
  }
  return brokenLinks;
}

async function main() {
  const missingFiles = [];
  for (const requiredFilePath of REQUIRED_FILES) {
    if (!(await fileExists(requiredFilePath))) {
      missingFiles.push(requiredFilePath);
    }
  }

  const readme = await fileExists("README.md")
    ? await readFile("README.md", "utf8")
    : "";
  const missingReadmeSections = REQUIRED_README_PATTERNS
    .filter(({ re: sectionPattern }) => !sectionPattern.test(readme))
    .map(({ name: sectionName }) => sectionName);

  let missingApiReferenceEntries;
  if (await fileExists(API_ENTRYPOINT_PATH) && await fileExists(API_REFERENCE_PATH)) {
    const [entrypointSource, apiReference] = await Promise.all([
      readFile(API_ENTRYPOINT_PATH, "utf8"),
      readFile(API_REFERENCE_PATH, "utf8")
    ]);
    const runtimeExports = collectRuntimeExports(entrypointSource);
    missingApiReferenceEntries = runtimeExports.filter((name) => {
      const symbolMarker = `\`${name}`;
      return !apiReference.includes(symbolMarker);
    });
  } else {
    missingApiReferenceEntries = ["api-reference-check-input-missing"];
  }

  const markdownFiles = [
    "README.md",
    "CONTRIBUTING.md",
    "RELEASING.md",
    "SECURITY.md",
    "SUPPORT.md",
    "THIRD_PARTY_NOTICES.md",
    ...await collectMarkdownFiles("docs")
  ];
  const brokenRelativeLinks = await collectBrokenRelativeLinks(markdownFiles);
  const isDocsCheckPass =
    missingFiles.length === 0
    && missingReadmeSections.length === 0
    && missingApiReferenceEntries.length === 0
    && brokenRelativeLinks.length === 0;

  const report = {
    suite: "docs",
    timestamp: nowIso(),
    ok: isDocsCheckPass,
    missingFiles,
    missingReadmeSections,
    missingApiReferenceEntries,
    markdownFilesChecked: markdownFiles.length,
    brokenRelativeLinks
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
