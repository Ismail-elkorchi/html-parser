import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

import { analyzeDeclarationGraph } from "../build/declaration-graph.mjs";
import { nowIso, writeJson, fileExists, readJson } from "./eval-primitives.mjs";

const REMOVED_RUNTIME_HASHES = new Set([
  "5d8ee93923d609724c69c8c356147176af5226585d4f343c87a5eec6590ebca9",
  "de563a36e2cca4264751e27221783fe2b987e3bf012cb002063df40960a49ee8",
  "b035b71d6969983297e39df1a06d760f2a8000a0f98444c4fe845fe1155da451",
  "e28599f48fddd869435e44e6ae8644e70a610450d97562e33c869c056e3b129f",
  "855d8cd764782cdc73003a9847d03ed261c5158f6a6901e563ccd4d3b92c8b16",
  "b38ae5ac4f2a31ce2e1cfeca35cf7b89cc66736cd5be068cc433a3ccaca78be2",
  "129a84a9d04b6050b6896de45a70e1ee468434e19bdd6486e3aef3405d137cac",
  "e6cf93f387be70ddcd4f2bec67fbeb53161094f6306d834de461ec888a9dab76",
  "52dac9efba3a637771818d633a5cf1df30c7913d05ff23235150c88319ea035a",
  "69a0a52be895d2bcf88850beead4a098c5305c0b5669d1e8a0fe26f621ea25c6",
  "a6e04b000b228a0bf7eba4e5462b343ec1e13dbfbe40bce913ade646bbde4461",
  "2ea256f2e3a2821ecb093e0693fd1f69b67512ce26f7f9511d0ac0873c54c81f",
  "fe4b609a572c9aa06fbd45ac53632b3ad565168903f4126a6f98d5a9d1f42999",
  "48337e871cbe717aae264c5486c68d4a10f60f79e749bcf2c5d5c73b5e7fdca6",
  "12199175a31eb461dcecefa10ce2536c69ab92cdd2a1f67da3ea20b214599ac1",
  "14b6408b0abb1c041e645644f977db34da280239be8a59a2eb3c9e282e89b7c4"
]);
const REMOVED_RUNTIME_PATH_PARTS = Object.freeze([
  ["dist", "internal", "vendor"].join("/"),
  ["dist", "internal", ["parse", "5-runtime"].join("")].join("/")
]);

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
  const removedRuntimePaths = normalizedPaths.filter((tarPath) =>
    REMOVED_RUNTIME_PATH_PARTS.some((part) => tarPath.startsWith(part))
  );
  const removedRuntimeFingerprints = archivedEntries
    .filter((entry) => REMOVED_RUNTIME_HASHES.has(sha256(entry.content)))
    .map((entry) => entry.path);
  const jsrEngineExcluded = Array.isArray(jsrManifest.exclude) &&
    jsrManifest.exclude.includes("src/internal/html-engine/**");
  const expectedJsrPublishIncludes = [
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "SUPPORT.md",
    "THIRD_PARTY_NOTICES.md",
    "docs/*.md",
    "jsr/mod.ts",
    "src/**/*.ts"
  ];
  const jsrPublishIncludes = Array.isArray(jsrManifest.publish?.include)
    ? [...jsrManifest.publish.include].sort()
    : [];
  const jsrPublishExcludes = Array.isArray(jsrManifest.publish?.exclude)
    ? [...jsrManifest.publish.exclude].sort()
    : [];
  const expectedJsrWorkspaceExcludes = [
    "dist/**",
    "html-parser-*.tgz",
    "node_modules/**",
    "reports/**",
    "tmp/**"
  ];
  const jsrWorkspaceExcludes = Array.isArray(jsrManifest.exclude)
    ? [...jsrManifest.exclude].sort()
    : [];
  const jsrPublicationBoundaryValid =
    JSON.stringify(jsrPublishIncludes) === JSON.stringify(expectedJsrPublishIncludes) &&
    jsrPublishExcludes.length === 0 &&
    JSON.stringify(jsrWorkspaceExcludes) === JSON.stringify(expectedJsrWorkspaceExcludes);

  const forbiddenIncluded = normalizedPaths.filter((tarPath) =>
    forbiddenPrefixes.some((forbiddenPrefix) => tarPath.startsWith(forbiddenPrefix))
  );
  const thirdPartyNoticesIncluded = normalizedPaths.includes("THIRD_PARTY_NOTICES.md");
  const requiredDocumentation = [
    "README.md",
    "SECURITY.md",
    "SUPPORT.md",
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
  ];
  const missingDocumentation = requiredDocumentation.filter(
    (documentationPath) => !normalizedPaths.includes(documentationPath)
  );

  const firstPartyDistEntries = archivedEntries.filter((entry) =>
    entry.path.startsWith("dist/")
  );
  const firstPartyDist = {
    files: firstPartyDistEntries.length,
    bytes: firstPartyDistEntries.reduce((total, entry) => total + entry.size, 0)
  };
  function inventory(entries) {
    return {
      files: entries.length,
      bytes: entries.reduce((total, entry) => total + entry.size, 0)
    };
  }
  const embeddedImplementationEntries = firstPartyDistEntries.filter((entry) =>
    entry.path.startsWith("dist/internal/") && entry.path.endsWith(".js")
  );
  const publicRuntimeEntries = firstPartyDistEntries.filter((entry) =>
    entry.path.endsWith(".js") && !entry.path.startsWith("dist/internal/")
  );
  const declarationEntries = firstPartyDistEntries.filter((entry) =>
    entry.path.endsWith(".d.ts")
  );
  const declarationGraph = analyzeDeclarationGraph(new Map(declarationEntries.map((entry) => [
    entry.path,
    entry.content.toString("utf8")
  ])), "dist/mod.d.ts");
  const privateDeclarationPaths = normalizedPaths.filter((tarPath) =>
    tarPath.startsWith("dist/internal/") && tarPath.endsWith(".d.ts")
  );
  const maintainerDocumentationPaths = normalizedPaths.filter((tarPath) =>
    tarPath.startsWith("docs/maintainers/")
  );
  const repositoryWorkflowDocumentationPaths = normalizedPaths.filter((tarPath) =>
    tarPath === "CONTRIBUTING.md" || tarPath === "RELEASING.md"
  );

  const isPackagingCheckPass =
    dependenciesEmpty &&
    esmOnly &&
    exportsOk &&
    forbiddenIncluded.length === 0 &&
    thirdPartyNoticesIncluded &&
    removedRuntimePaths.length === 0 &&
    removedRuntimeFingerprints.length === 0 &&
    !jsrEngineExcluded &&
    jsrPublicationBoundaryValid &&
    privateDeclarationPaths.length === 0 &&
    maintainerDocumentationPaths.length === 0 &&
    repositoryWorkflowDocumentationPaths.length === 0 &&
    declarationGraph.rootFound &&
    declarationGraph.unresolved.length === 0 &&
    declarationGraph.unreachable.length === 0 &&
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
      firstPartyDist,
      embeddedImplementation: inventory(embeddedImplementationEntries),
      publicRuntime: inventory(publicRuntimeEntries),
      publicDeclarations: inventory(declarationEntries)
    },
    esmOnly,
    exportsOk,
    removedRuntimePaths,
    removedRuntimeFingerprints,
    jsrEngineExcluded,
    jsrPublicationBoundaryValid,
    jsrPublishIncludes,
    jsrPublishExcludes,
    jsrWorkspaceExcludes,
    forbiddenIncluded,
    thirdPartyNoticesIncluded,
    privateDeclarationPaths,
    maintainerDocumentationPaths,
    repositoryWorkflowDocumentationPaths,
    declarationGraph,
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
