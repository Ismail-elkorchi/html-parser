import { readFile } from "node:fs/promises";
import { fileExists, writeJson, nowIso } from "./eval-primitives.mjs";

const REQUIRED_FILES = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "CHANGELOG.md",
  "SUPPORT.md",
  "docs/index.md",
  "docs/tutorial/first-parse.md",
  "docs/how-to/release-validation.md",
  "docs/reference/api-overview.md",
  "docs/explanation/architecture-and-tradeoffs.md",
  "docs/security-triage.md",
  "docs/third-party.md",
  "docs/update-playbook.md",
  "docs/debt.md",
  "docs/naming-conventions.md",
  "docs/decisions/README.md",
  "docs/acceptance-gates.md",
  "docs/eval-report-format.md"
];

const REQUIRED_README_PATTERNS = [
  { name: "Docs map", re: /docs\/index\.md/i },
  { name: "Examples section", re: /examples:run/i },
  { name: "Runtime compatibility", re: /runtime\s+compat/i },
  { name: "Security", re: /\bsecurity\b/i },
  { name: "No runtime dependencies statement", re: /no\s+runtime\s+depend/i }
];

const PUBLIC_MOD_PATH = "src/public/mod.ts";
const API_REFERENCE_PATH = "docs/reference/api-overview.md";

function collectExportedFunctionNames(modSource) {
  const names = [];
  const exportFunctionPattern = /export\s+(?:async\s+)?function\*?\s+([A-Za-z0-9_]+)/g;
  let match;
  while ((match = exportFunctionPattern.exec(modSource)) !== null) {
    names.push(match[1]);
  }
  return names;
}

async function main() {
  const missingFiles = [];
  for (const requiredFilePath of REQUIRED_FILES) {
    if (!(await fileExists(requiredFilePath))) missingFiles.push(requiredFilePath);
  }

  let readme = "";
  if (await fileExists("README.md")) {
    readme = await readFile("README.md", "utf8");
  }

  const missingReadmeSections = [];
  for (const { name: sectionName, re: sectionPattern } of REQUIRED_README_PATTERNS) {
    if (!sectionPattern.test(readme)) missingReadmeSections.push(sectionName);
  }

  let missingApiReferenceEntries = [];
  if (await fileExists(PUBLIC_MOD_PATH) && await fileExists(API_REFERENCE_PATH)) {
    const [modSource, apiReference] = await Promise.all([
      readFile(PUBLIC_MOD_PATH, "utf8"),
      readFile(API_REFERENCE_PATH, "utf8")
    ]);
    const exportedFunctionNames = collectExportedFunctionNames(modSource);
    missingApiReferenceEntries = exportedFunctionNames.filter(
      (name) => !apiReference.includes(`\`${name}\``)
    );
  } else {
    missingApiReferenceEntries = ["api-reference-check-input-missing"];
  }

  const isDocsCheckPass = (
    missingFiles.length === 0 &&
    missingReadmeSections.length === 0 &&
    missingApiReferenceEntries.length === 0
  );

  const report = {
    suite: "docs",
    timestamp: nowIso(),
    ok: isDocsCheckPass,
    missingFiles,
    missingReadmeSections,
    missingApiReferenceEntries
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
