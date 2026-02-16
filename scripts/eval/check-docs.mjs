import { readFile } from "node:fs/promises";
import { fileExists, writeJson, nowIso } from "./util.mjs";

const REQUIRED_FILES = [
  "README.md",
  "SECURITY.md",
  "LICENSE",
  "docs/third-party.md",
  "docs/update-playbook.md",
  "docs/debt.md",
  "docs/naming-conventions.md",
  "docs/spec-snapshots.md",
  "docs/decisions/README.md",
  "docs/acceptance-gates.md",
  "docs/eval-report-format.md"
];

const REQUIRED_README_PATTERNS = [
  { name: "Runtime compatibility", re: /runtime\s+compat/i },
  { name: "Security", re: /\bsecurity\b/i },
  { name: "No runtime dependencies statement", re: /no\s+runtime\s+depend/i }
];

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

  const ok = missingFiles.length === 0 && missingReadmeSections.length === 0;

  const report = {
    suite: "docs",
    timestamp: nowIso(),
    ok,
    missingFiles,
    missingReadmeSections
  };

  await writeJson("reports/docs.json", report);

  if (!ok) {
    console.error("EVAL: Docs check failed:", report);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
