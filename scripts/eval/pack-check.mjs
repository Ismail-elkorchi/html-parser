import { spawnSync } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { nowIso, writeJson, fileExists, readJson } from "./eval-primitives.mjs";

function parseTarFileList(tarBytes) {
  const archivedFiles = [];
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
    const sizeRaw = header.subarray(124, 136);
    const sizeStr = Buffer.from(sizeRaw).toString("utf8").replace(/\0.*$/, "").trim();
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;

    if (name) archivedFiles.push(name);

    const padded = Math.ceil(size / BLOCK) * BLOCK;
    offset += padded;
  }

  return archivedFiles;
}

async function main() {
  if (!(await fileExists("package.json"))) {
    const report = { suite: "pack", timestamp: nowIso(), ok: false, reason: "package.json missing" };
    await writeJson("reports/pack.json", report);
    process.exit(1);
  }

  const packageManifest = JSON.parse(await readFile("package.json", "utf8"));
  const runtimeDependencies = packageManifest.dependencies || {};
  const dependenciesEmpty = Object.keys(runtimeDependencies).length === 0;

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
  const archivedFiles = parseTarFileList(tarBytes);

  const normalizedPaths = archivedFiles.map((archivedPath) => archivedPath.replace(/^package\//, ""));

  const forbiddenIncluded = normalizedPaths.filter((tarPath) =>
    forbiddenPrefixes.some((forbiddenPrefix) => tarPath.startsWith(forbiddenPrefix))
  );
  const thirdPartyNoticesIncluded = normalizedPaths.includes("THIRD_PARTY_NOTICES.md");

  const isPackagingCheckPass =
    dependenciesEmpty &&
    esmOnly &&
    exportsOk &&
    forbiddenIncluded.length === 0 &&
    thirdPartyNoticesIncluded;

  const report = {
    suite: "pack",
    timestamp: nowIso(),
    ok: isPackagingCheckPass,
    tarball,
    dependenciesEmpty,
    esmOnly,
    exportsOk,
    forbiddenIncluded,
    thirdPartyNoticesIncluded
  };

  await writeJson("reports/pack.json", report);

  await unlink(tarball).catch(() => {});

  if (!isPackagingCheckPass) {
    console.error("EVAL: Packaging check failed:", report);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("EVAL:", error);
  process.exit(1);
});
