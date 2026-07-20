import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { collectModuleSpecifiers } from "../lib/module-specifiers.mjs";
import { writeJson } from "../lib/report.mjs";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

async function javascriptFiles(root) {
  const files = [];
  const directories = [root];
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory === undefined) break;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) directories.push(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(entryPath);
    }
  }
  return files.sort();
}

const packageManifest = JSON.parse(await readFile("package.json", "utf8"));
const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));
const runtimeDependencies = Object.keys(packageManifest.dependencies ?? {}).sort();
const lockedRuntimeDependencies = Object.keys(packageLock.packages?.[""]?.dependencies ?? {}).sort();

const auditRun = run("npm", ["audit", "--omit=dev", "--json"]);
let audit;
try {
  audit = JSON.parse(auditRun.stdout);
} catch {
  audit = null;
}
const vulnerabilityCounts = audit?.metadata?.vulnerabilities ?? null;
const auditClean = auditRun.code === 0 && vulnerabilityCounts !== null &&
  Object.values(vulnerabilityCounts).every((count) => count === 0);

const sbomRun = run("npm", ["sbom", "--omit=dev", "--sbom-format=cyclonedx"]);
let sbom;
try {
  sbom = JSON.parse(sbomRun.stdout);
} catch {
  sbom = null;
}
const sbomValid = sbomRun.code === 0 && sbom?.bomFormat === "CycloneDX";

const productionRoots = ["dist"];
const bareImports = [];
for (const root of productionRoots) {
  for (const file of await javascriptFiles(root)) {
    const source = await readFile(file, "utf8");
    for (const { specifier } of collectModuleSpecifiers(source, file)) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        bareImports.push({ file, specifier });
      }
    }
  }
}

const characterReferenceCheck = run(process.execPath, [
  "scripts/generate/generate-named-character-references.mjs",
  "--check"
]);
const notices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");
const publishWorkflow = await readFile(".github/workflows/publish.yml", "utf8");
const manualPublishWorkflow = await readFile(".github/workflows/publish-manual.yml", "utf8");
const provenance = {
  npm: publishWorkflow.includes("npm publish --provenance") &&
    manualPublishWorkflow.includes("npm publish --provenance"),
  jsr: publishWorkflow.includes("jsr publish --allow-dirty --provenance") &&
    manualPublishWorkflow.includes("jsr publish --allow-dirty --provenance")
};
const noticeCoverage = {
  wpt: notices.includes("web-platform-tests") || notices.includes("WPT"),
  characterReferences: notices.includes("named character") || notices.includes("entities.json")
};

const report = {
  schemaVersion: 2,
  suite: "html-parser-supply-chain",
  generatedAt: new Date().toISOString(),
  manifests: {
    version: packageManifest.version,
    runtimeDependencies,
    lockedRuntimeDependencies
  },
  audit: {
    clean: auditClean,
    exitCode: auditRun.code,
    vulnerabilityCounts
  },
  sbom: {
    valid: sbomValid,
    format: sbom?.bomFormat ?? null,
    specVersion: sbom?.specVersion ?? null,
    components: Array.isArray(sbom?.components) ? sbom.components.length : null
  },
  productionImports: {
    roots: productionRoots,
    bareImports
  },
  characterReferences: {
    exactGeneratedData: characterReferenceCheck.code === 0,
    output: characterReferenceCheck.stdout.trim()
  },
  provenance,
  noticeCoverage
};
const ok = runtimeDependencies.length === 0 && lockedRuntimeDependencies.length === 0 &&
  auditClean && sbomValid && bareImports.length === 0 &&
  report.characterReferences.exactGeneratedData &&
  Object.values(provenance).every(Boolean) && Object.values(noticeCoverage).every(Boolean);
await writeJson("reports/supply-chain.json", { ...report, ok });
console.log(JSON.stringify({ ...report, ok }, null, 2));
if (!ok) process.exitCode = 1;
