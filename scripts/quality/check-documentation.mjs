import { readFile, readdir } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

import { fileExists, nowIso, writeJson } from "../lib/report.mjs";

const ROOT_DOCUMENTS = Object.freeze([
  "README.md",
  "CONTRIBUTING.md",
  "RELEASING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "THIRD_PARTY_NOTICES.md"
]);

async function collectMarkdownFiles(directoryPath) {
  const files = [];
  for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) files.push(...await collectMarkdownFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(entryPath);
  }
  return files;
}

function relativeTargets(markdown) {
  const targets = [];
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1]?.trim().replace(/^<|>$/g, "");
    if (!rawTarget || rawTarget.startsWith("#") || rawTarget.startsWith("/") ||
        /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) {
      continue;
    }
    const fileTarget = rawTarget.split("#", 1)[0]?.split("?", 1)[0];
    if (fileTarget) targets.push(fileTarget);
  }
  return targets;
}

const missingRoots = [];
for (const rootDocument of ROOT_DOCUMENTS) {
  if (!(await fileExists(rootDocument))) missingRoots.push(rootDocument);
}
if (!(await fileExists("docs/index.md"))) missingRoots.push("docs/index.md");

const markdownFiles = [
  ...ROOT_DOCUMENTS.filter((filePath) => !missingRoots.includes(filePath)),
  ...(await fileExists("docs") ? await collectMarkdownFiles("docs") : [])
].sort();
const brokenLinks = [];
for (const markdownFile of markdownFiles) {
  const markdown = await readFile(markdownFile, "utf8");
  for (const target of relativeTargets(markdown)) {
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

const report = {
  schemaVersion: 1,
  suite: "html-parser-documentation",
  generatedAt: nowIso(),
  ok: missingRoots.length === 0 && brokenLinks.length === 0,
  filesChecked: markdownFiles.length,
  missingRoots,
  brokenLinks
};
await writeJson("reports/documentation.json", report);
if (!report.ok) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
