import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { analyzeDeclarationGraph } from "../build/declaration-graph.mjs";
import { nowIso, sha256, writeJson } from "../lib/report.mjs";

const REPORT_PATH = "reports/package.json";
const WORK_DIRECTORY = path.resolve("tmp/package-qualification");
const FORBIDDEN_PREFIXES = Object.freeze([
  "scripts/",
  "test/",
  "vendor/",
  "dist/internal/vendor/"
]);
const REQUIRED_FILES = Object.freeze([
  "dist/mod.js",
  "dist/mod.d.ts",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "docs/index.md",
  "docs/getting-started.md",
  "docs/api.md",
  "docs/architecture.md",
  "docs/data-model.md",
  "docs/limits-errors-and-safety.md",
  "docs/modifying-html.md",
  "docs/parsing.md",
  "docs/querying-and-text.md",
  "docs/streams-and-encoding.md"
]);
const EXPECTED_JSR_INCLUDE = Object.freeze([
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "THIRD_PARTY_NOTICES.md",
  "docs/*.md",
  "jsr/mod.ts",
  "src/**/*.ts"
]);
const EXPECTED_JSR_EXCLUDE = Object.freeze([
  "dist/**",
  "html-parser-*.tgz",
  "node_modules/**",
  "reports/**",
  "tmp/**"
]);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: options.stdio ?? "pipe"
  });
}

function inventory(files) {
  return Object.freeze({
    files: files.length,
    bytes: files.reduce((total, file) => total + file.size, 0)
  });
}

function exactArray(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

async function qualifyInstalledPackage(tarballPath, packageManifest) {
  const consumer = path.join(WORK_DIRECTORY, "consumer");
  await mkdir(consumer, { recursive: true });
  const tarballName = path.basename(tarballPath);
  await Promise.all([
    copyFile(tarballPath, path.join(consumer, tarballName)),
    copyFile("test/contracts/consumers/npm/index.ts", path.join(consumer, "index.ts")),
    copyFile("test/contracts/consumers/npm/runtime.mjs", path.join(consumer, "runtime.mjs")),
    copyFile("test/contracts/consumers/npm/tsconfig.json", path.join(consumer, "tsconfig.json")),
    writeFile(
      path.join(consumer, "package.json"),
      `${JSON.stringify({ name: "html-parser-package-consumer", private: true, type: "module" }, null, 2)}\n`,
      "utf8"
    )
  ]);

  run("npm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--omit=dev",
    `./${tarballName}`
  ], { cwd: consumer });
  run(process.execPath, ["runtime.mjs"], { cwd: consumer });
  run(process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], {
    cwd: consumer
  });

  const installedManifest = JSON.parse(await readFile(
    path.join(consumer, "node_modules", ...packageManifest.name.split("/"), "package.json"),
    "utf8"
  ));
  if (installedManifest.version !== packageManifest.version) {
    throw new Error(
      `installed package version ${String(installedManifest.version)} does not match ${packageManifest.version}`
    );
  }
  return Object.freeze({
    version: installedManifest.version,
    runtimeConsumer: "pass",
    strictTypeScriptConsumer: "pass",
    installation: "offline production-only with lifecycle scripts disabled"
  });
}

let tarballPath;
let report;
try {
  const [packageManifest, packageLock, jsrManifest] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("package-lock.json", "utf8").then(JSON.parse),
    readFile("jsr.json", "utf8").then(JSON.parse)
  ]);
  const pack = JSON.parse(run("npm", ["pack", "--json"]));
  const packInfo = pack[0];
  if (typeof packInfo?.filename !== "string" || !Array.isArray(packInfo.files)) {
    throw new Error("npm pack --json did not return a file inventory and tarball name");
  }
  tarballPath = path.resolve(packInfo.filename);
  const tarballBytes = await readFile(tarballPath);
  const files = packInfo.files.map((file) => ({
    path: String(file.path).replaceAll("\\", "/"),
    size: Number(file.size)
  }));
  const paths = files.map((file) => file.path);
  const pathSet = new Set(paths);
  const runtimeDependencies = Object.keys(packageManifest.dependencies ?? {}).sort();
  const lockedRuntimeDependencies = Object.keys(
    packageLock.packages?.[""]?.dependencies ?? {}
  ).sort();
  const manifestBoundary = {
    namesMatch: jsrManifest.name === packageManifest.name,
    versionsMatch: jsrManifest.version === packageManifest.version,
    esmEntrypoint: packageManifest.type === "module" &&
      packageManifest.main === "./dist/mod.js" &&
      packageManifest.types === "./dist/mod.d.ts" &&
      packageManifest.exports?.["."]?.import === "./dist/mod.js" &&
      packageManifest.exports?.["."]?.types === "./dist/mod.d.ts",
    jsrEntrypoint: jsrManifest.exports?.["."] === "./jsr/mod.ts",
    jsrInclude: exactArray(jsrManifest.publish?.include ?? [], EXPECTED_JSR_INCLUDE),
    jsrExclude: exactArray(jsrManifest.exclude ?? [], EXPECTED_JSR_EXCLUDE) &&
      (jsrManifest.publish?.exclude === undefined || jsrManifest.publish.exclude.length === 0)
  };
  const forbiddenFiles = paths.filter((filePath) =>
    FORBIDDEN_PREFIXES.some((prefix) => filePath.startsWith(prefix)) ||
    filePath === "CONTRIBUTING.md" || filePath === "RELEASING.md" ||
    filePath.startsWith("docs/maintainers/")
  );
  const missingFiles = REQUIRED_FILES.filter((filePath) => !pathSet.has(filePath));
  const declarationFiles = files.filter((file) => file.path.endsWith(".d.ts"));
  const declarationSources = new Map(await Promise.all(declarationFiles.map(async (file) => [
    file.path,
    await readFile(file.path, "utf8")
  ])));
  const declarationGraph = analyzeDeclarationGraph(declarationSources, "dist/mod.d.ts");
  const privateDeclarations = declarationFiles
    .filter((file) => file.path.startsWith("dist/internal/"))
    .map((file) => file.path);
  const runtimeFiles = files.filter((file) => file.path.endsWith(".js"));
  const internalRuntime = runtimeFiles.filter((file) => file.path.startsWith("dist/internal/"));
  const publicRuntime = runtimeFiles.filter((file) => !file.path.startsWith("dist/internal/"));

  await rm(WORK_DIRECTORY, { recursive: true, force: true });
  const installed = await qualifyInstalledPackage(tarballPath, packageManifest);
  const failures = [];
  if (runtimeDependencies.length > 0) failures.push("package-runtime-dependencies");
  if (lockedRuntimeDependencies.length > 0) failures.push("lockfile-runtime-dependencies");
  for (const [name, valid] of Object.entries(manifestBoundary)) {
    if (!valid) failures.push(`manifest:${name}`);
  }
  if (forbiddenFiles.length > 0) failures.push("forbidden-package-files");
  if (missingFiles.length > 0) failures.push("missing-package-files");
  if (privateDeclarations.length > 0) failures.push("private-declarations-published");
  if (!declarationGraph.rootFound || declarationGraph.unresolved.length > 0 ||
      declarationGraph.unreachable.length > 0) {
    failures.push("declaration-graph");
  }

  report = {
    schemaVersion: 1,
    suite: "html-parser-package",
    generatedAt: nowIso(),
    ok: failures.length === 0,
    package: { name: packageManifest.name, version: packageManifest.version },
    tarball: {
      name: packInfo.filename,
      bytes: tarballBytes.byteLength,
      sha256: sha256(tarballBytes),
      integrity: packInfo.integrity ?? null,
      files: files.length
    },
    runtimeDependencies,
    lockedRuntimeDependencies,
    manifestBoundary,
    missingFiles,
    forbiddenFiles,
    privateDeclarations,
    declarationGraph,
    composition: {
      distribution: inventory(files.filter((file) => file.path.startsWith("dist/"))),
      internalRuntime: inventory(internalRuntime),
      publicRuntime: inventory(publicRuntime),
      declarations: inventory(declarationFiles)
    },
    installed,
    failures
  };
} catch (error) {
  report = {
    schemaVersion: 1,
    suite: "html-parser-package",
    generatedAt: nowIso(),
    ok: false,
    failures: [error instanceof Error ? `${error.name}: ${error.message}` : String(error)]
  };
} finally {
  if (tarballPath !== undefined) await rm(tarballPath, { force: true });
  await rm(WORK_DIRECTORY, { recursive: true, force: true });
}

await writeJson(REPORT_PATH, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
