import { spawnSync } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { nowIso, writeJson, fileExists, readJson } from "./util.mjs";

function parseTarFileList(tarBytes) {
  const files = [];
  const BLOCK = 512;
  let offset = 0;

  function isAllZero(buf) {
    for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) return false;
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

    if (name) files.push(name);

    const padded = Math.ceil(size / BLOCK) * BLOCK;
    offset += padded;
  }

  return files;
}

async function main() {
  if (!(await fileExists("package.json"))) {
    const report = { suite: "pack", timestamp: nowIso(), ok: false, reason: "package.json missing" };
    await writeJson("reports/pack.json", report);
    process.exit(1);
  }

  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const deps = pkg.dependencies || {};
  const dependenciesEmpty = Object.keys(deps).length === 0;

  const esmOnly = pkg.type === "module" && !JSON.stringify(pkg.exports || {}).includes('"require"');

  const exportsOk = typeof pkg.exports === "object" || typeof pkg.exports === "string";

  const config = (await fileExists("evaluation.config.json")) ? await readJson("evaluation.config.json") : null;
  const forbiddenPrefixes = config?.thresholds?.packaging?.forbiddenPaths || ["vendor/", "test/", "codex-prompts/", "scripts/"];

  const res = spawnSync("npm", ["pack", "--json"], { encoding: "utf8" });
  if (res.status !== 0) {
    const report = {
      suite: "pack",
      timestamp: nowIso(),
      ok: false,
      dependenciesEmpty,
      esmOnly,
      exportsOk,
      reason: "npm pack failed",
      stderr: res.stderr
    };
    await writeJson("reports/pack.json", report);
    process.exit(1);
  }

  let packInfo;
  try {
    packInfo = JSON.parse(res.stdout);
  } catch {
    const report = {
      suite: "pack",
      timestamp: nowIso(),
      ok: false,
      dependenciesEmpty,
      esmOnly,
      exportsOk,
      reason: "npm pack --json produced invalid JSON",
      stdout: res.stdout
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
  const files = parseTarFileList(tarBytes);

  const normalized = files.map((f) => f.replace(/^package\//, ""));

  const forbiddenIncluded = normalized.filter((p) => forbiddenPrefixes.some((pref) => p.startsWith(pref)));

  const ok = dependenciesEmpty && esmOnly && exportsOk && forbiddenIncluded.length === 0;

  const report = {
    suite: "pack",
    timestamp: nowIso(),
    ok,
    tarball,
    dependenciesEmpty,
    esmOnly,
    exportsOk,
    forbiddenIncluded
  };

  await writeJson("reports/pack.json", report);

  await unlink(tarball).catch(() => {});

  if (!ok) {
    console.error("Packaging check failed:", report);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
