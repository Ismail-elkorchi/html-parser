import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

import { verifyLegacyRuntimeSeal } from "../legacy/verify-runtime-seal.mjs";
import { nowIso, writeJson, fileExists, readJson } from "./eval-primitives.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseTarEntries(tarBytes) {
  const archivedEntries = [];
  const BLOCK = 512;
  let offset = 0;

  function isAllZero(blockBytes) {
    for (let byteIndex = 0; byteIndex < blockBytes.length; byteIndex += 1) {
      if (blockBytes[byteIndex] !== 0) return false;
    }
    return true;
  }

  while (offset + BLOCK <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + BLOCK);
    offset += BLOCK;

    if (isAllZero(header)) break;

    const nameRaw = header.subarray(0, 100);
    const name = Buffer.from(nameRaw).toString("utf8").replace(/\0.*$/, "");
    const prefixRaw = header.subarray(345, 500);
    const prefix = Buffer.from(prefixRaw).toString("utf8").replace(/\0.*$/, "");
    const archivePath = prefix ? `${prefix}/${name}` : name;
    const sizeRaw = header.subarray(124, 136);
    const sizeStr = Buffer.from(sizeRaw).toString("utf8").replace(/\0.*$/, "").trim();
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;
    const type = String.fromCharCode(header[156] ?? 0);
    const content = tarBytes.subarray(offset, offset + size);

    if (archivePath && (type === "0" || type === "\0")) {
      archivedEntries.push({ path: archivePath, size, content });
    }

    const padded = Math.ceil(size / BLOCK) * BLOCK;
    offset += padded;
  }

  return archivedEntries;
}

async function main() {
  if (!(await fileExists("package.json"))) {
    const report = { suite: "pack", timestamp: nowIso(), ok: false, reason: "package.json missing" };
    await writeJson("reports/pack.json", report);
    process.exit(1);
  }

  const packageManifest = JSON.parse(await readFile("package.json", "utf8"));
  const jsrManifest = JSON.parse(await readFile("jsr.json", "utf8"));
  const dependencyFieldValid =
    packageManifest.dependencies !== null &&
    typeof packageManifest.dependencies === "object" &&
    !Array.isArray(packageManifest.dependencies);
  const runtimeDependencies = dependencyFieldValid ? packageManifest.dependencies : {};
  const installedDependencyNames = Object.keys(runtimeDependencies).sort();
  const dependenciesEmpty = dependencyFieldValid && installedDependencyNames.length === 0;
  const installedDependencies = {
    declaredBy: "package.json dependencies",
    validObject: dependencyFieldValid,
    count: installedDependencyNames.length,
    names: installedDependencyNames,
    empty: dependenciesEmpty
  };

  const legacyManifest = JSON.parse(await readFile("legacy-runtime-manifest.json", "utf8"));
  const sourceLegacySeal = await verifyLegacyRuntimeSeal();

  const esmOnly = packageManifest.type === "module" && !JSON.stringify(packageManifest.exports || {}).includes('"require"');

  const exportsOk = typeof packageManifest.exports === "object" || typeof packageManifest.exports === "string";

  const config = (await fileExists("evaluation.config.json")) ? await readJson("evaluation.config.json") : null;
  const forbiddenPrefixes = config?.thresholds?.packaging?.forbiddenPaths || ["vendor/", "test/", "codex-prompts/", "scripts/"];

  const packCommandResult = spawnSync("npm", ["pack", "--json"], { encoding: "utf8" });
  if (packCommandResult.status !== 0) {
    const report = {
      suite: "pack",
      timestamp: nowIso(),
      ok: false,
      dependenciesEmpty,
      esmOnly,
      exportsOk,
      reason: "npm pack failed",
      stderr: packCommandResult.stderr
    };
    await writeJson("reports/pack.json", report);
    process.exit(1);
  }

  let packInfo;
  try {
    packInfo = JSON.parse(packCommandResult.stdout);
  } catch {
    const report = {
      suite: "pack",
      timestamp: nowIso(),
      ok: false,
      dependenciesEmpty,
      esmOnly,
      exportsOk,
      reason: "npm pack --json produced invalid JSON",
      stdout: packCommandResult.stdout
    };
    await writeJson("reports/pack.json", report);
    process.exit(1);
  }

  const tarball = packInfo?.[0]?.filename;
  if (!tarball || !(await fileExists(tarball))) {
    const report = {
      suite: "pack",
      timestamp: nowIso(),
      ok: false,
      dependenciesEmpty,
      esmOnly,
      exportsOk,
      reason: "tarball not found after npm pack",
      tarball
    };
    await writeJson("reports/pack.json", report);
    process.exit(1);
  }

  const tgzBytes = await readFile(tarball);
  const tarBytes = gunzipSync(tgzBytes);
  const archivedEntries = parseTarEntries(tarBytes).map((entry) => ({
    ...entry,
    path: entry.path.replace(/^package\//, "")
  }));
  const normalizedPaths = archivedEntries.map((entry) => entry.path);
  const unpublishedEngineIncluded = normalizedPaths.some((tarPath) =>
    tarPath.startsWith("dist/internal/html-engine/")
  );
  const stagedIntegrationIncluded = normalizedPaths.some((tarPath) =>
    tarPath.startsWith("dist/integration/")
  );
  const jsrEngineExcluded = Array.isArray(jsrManifest.exclude) &&
    jsrManifest.exclude.includes("src/internal/html-engine/**");
  const jsrIntegrationExcluded = Array.isArray(jsrManifest.exclude) &&
    jsrManifest.exclude.includes("src/integration/**");

  const forbiddenIncluded = normalizedPaths.filter((tarPath) =>
    forbiddenPrefixes.some((forbiddenPrefix) => tarPath.startsWith(forbiddenPrefix))
  );
  const thirdPartyNoticesIncluded = normalizedPaths.includes("THIRD_PARTY_NOTICES.md");
  const legacyManifestIncluded = normalizedPaths.includes("legacy-runtime-manifest.json");
  const requiredDocumentation = [
    "README.md",
    "CONTRIBUTING.md",
    "RELEASING.md",
    "SECURITY.md",
    "SUPPORT.md",
    "docs/index.md",
    "docs/getting-started.md",
    "docs/api.md"
  ];
  const missingDocumentation = requiredDocumentation.filter(
    (documentationPath) => !normalizedPaths.includes(documentationPath)
  );

  const expectedLegacyFiles = new Map(
    legacyManifest.files.map((file) => [file.packagedPath, file])
  );
  const packagedLegacyEntries = archivedEntries.filter((entry) =>
    entry.path.startsWith(`${legacyManifest.packagedRoot}/`)
  );
  const packagedLegacyByPath = new Map(
    packagedLegacyEntries.map((entry) => [entry.path, entry])
  );
  const embeddedSealProblems = [];
  for (const [filePath, expected] of expectedLegacyFiles) {
    const actual = packagedLegacyByPath.get(filePath);
    if (!actual) {
      embeddedSealProblems.push(`missing packaged legacy file: ${filePath}`);
      continue;
    }
    const actualSha256 = sha256(actual.content);
    if (actual.size !== expected.bytes) {
      embeddedSealProblems.push(
        `packaged legacy byte count mismatch: ${filePath} expected=${String(expected.bytes)} actual=${String(actual.size)}`
      );
    }
    if (actualSha256 !== expected.sha256) {
      embeddedSealProblems.push(
        `packaged legacy SHA-256 mismatch: ${filePath} expected=${expected.sha256} actual=${actualSha256}`
      );
    }
  }
  for (const filePath of packagedLegacyByPath.keys()) {
    if (!expectedLegacyFiles.has(filePath)) {
      embeddedSealProblems.push(`unexpected packaged legacy file: ${filePath}`);
    }
  }

  const packagedLegacyCanonicalLines = packagedLegacyEntries
    .map((entry) => {
      const sourcePath = `${legacyManifest.sealedRoot}/${entry.path.slice(legacyManifest.packagedRoot.length + 1)}`;
      return { sourcePath, sha256: sha256(entry.content) };
    })
    .sort((left, right) =>
      left.sourcePath < right.sourcePath ? -1 : left.sourcePath > right.sourcePath ? 1 : 0
    )
    .map((entry) => `${entry.sha256}  ${entry.sourcePath}\n`)
    .join("");
  const packagedLegacyCompositeSha256 = sha256(
    Buffer.from(packagedLegacyCanonicalLines, "utf8")
  );
  if (packagedLegacyCompositeSha256 !== legacyManifest.composite.sha256) {
    embeddedSealProblems.push(
      `packaged legacy composite SHA-256 mismatch: expected=${legacyManifest.composite.sha256} actual=${packagedLegacyCompositeSha256}`
    );
  }

  const embeddedImplementationEntries = packagedLegacyEntries.filter((entry) =>
    entry.path.endsWith(".js")
  );
  const embeddedLicenseEntries = packagedLegacyEntries.filter((entry) =>
    !entry.path.endsWith(".js")
  );
  const embeddedLegacyImplementation = {
    delivery: "copied source inside dist; not an installed dependency",
    root: legacyManifest.packagedRoot,
    present: packagedLegacyEntries.length > 0,
    matchesSeal: embeddedSealProblems.length === 0,
    manifestIncluded: legacyManifestIncluded,
    files: embeddedImplementationEntries.length,
    bytes: embeddedImplementationEntries.reduce((total, entry) => total + entry.size, 0),
    licenseFiles: embeddedLicenseEntries.length,
    licenseBytes: embeddedLicenseEntries.reduce((total, entry) => total + entry.size, 0),
    totalFiles: packagedLegacyEntries.length,
    totalBytes: packagedLegacyEntries.reduce((total, entry) => total + entry.size, 0),
    compositeSha256: packagedLegacyCompositeSha256,
    expectedCompositeSha256: legacyManifest.composite.sha256,
    problems: embeddedSealProblems
  };

  const firstPartyDistEntries = archivedEntries.filter((entry) =>
    entry.path.startsWith("dist/") && !entry.path.startsWith(`${legacyManifest.packagedRoot}/`)
  );
  const firstPartyDist = {
    files: firstPartyDistEntries.length,
    bytes: firstPartyDistEntries.reduce((total, entry) => total + entry.size, 0)
  };

  const isPackagingCheckPass =
    dependenciesEmpty &&
    esmOnly &&
    exportsOk &&
    forbiddenIncluded.length === 0 &&
    thirdPartyNoticesIncluded &&
    legacyManifestIncluded &&
    embeddedLegacyImplementation.matchesSeal &&
    !unpublishedEngineIncluded &&
    !stagedIntegrationIncluded &&
    jsrEngineExcluded &&
    jsrIntegrationExcluded &&
    missingDocumentation.length === 0;

  const report = {
    suite: "pack",
    timestamp: nowIso(),
    ok: isPackagingCheckPass,
    tarball,
    tarballSha256: sha256(tgzBytes),
    npmIntegrity: packInfo?.[0]?.integrity ?? null,
    dependenciesEmpty,
    runtimeComposition: {
      installedDependencies,
      embeddedLegacyImplementation,
      firstPartyDist
    },
    sourceLegacySeal,
    esmOnly,
    exportsOk,
    unpublishedEngineIncluded,
    stagedIntegrationIncluded,
    jsrEngineExcluded,
    jsrIntegrationExcluded,
    forbiddenIncluded,
    thirdPartyNoticesIncluded,
    legacyManifestIncluded,
    missingDocumentation
  };

  await writeJson("reports/pack.json", report);

  await unlink(tarball).catch(() => {});

  if (!isPackagingCheckPass) {
    console.error("Packaging check failed:", report);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
