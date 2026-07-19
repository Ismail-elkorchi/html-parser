import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expandTreeDatCases, parseTreeDatFixtures } from "./tree-dat.mjs";
import { WPT_TREE_CORPUS_ROOT } from "./wpt-tree-corpus.mjs";

const WPT_REPOSITORY = "https://github.com/web-platform-tests/wpt.git";
const WPT_RESOURCE_ROOT = "html/syntax/parsing/resources";

function optionValue(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function git(repositoryRoot, args) {
  return execFileSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  }).trim();
}

async function acquireSource(commit) {
  const suppliedSource = optionValue("source");
  if (suppliedSource !== undefined) {
    const sourceRoot = path.resolve(suppliedSource);
    const actualCommit = git(sourceRoot, ["rev-parse", "HEAD"]);
    if (actualCommit !== commit) {
      throw new Error(`--source is at ${actualCommit}; expected ${commit}`);
    }
    return { sourceRoot, cleanup: async () => {} };
  }

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "html-parser-wpt-refresh-"));
  execFileSync("git", ["init", "--quiet", temporaryRoot], { stdio: "inherit" });
  git(temporaryRoot, ["remote", "add", "origin", WPT_REPOSITORY]);
  git(temporaryRoot, ["config", "core.sparseCheckout", "true"]);
  await writeFile(
    path.join(temporaryRoot, ".git", "info", "sparse-checkout"),
    "/LICENSE.md\n/html/syntax/parsing/resources/\n",
    "utf8"
  );
  git(temporaryRoot, ["fetch", "--depth=1", "origin", commit]);
  git(temporaryRoot, ["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  const actualCommit = git(temporaryRoot, ["rev-parse", "HEAD"]);
  if (actualCommit !== commit) {
    throw new Error(`fetched ${actualCommit}; expected ${commit}`);
  }
  return {
    sourceRoot: temporaryRoot,
    cleanup: () => rm(temporaryRoot, { recursive: true, force: true })
  };
}

async function replaceSnapshot(stagingRoot, destinationRoot) {
  const backupRoot = `${destinationRoot}.previous-${String(process.pid)}`;
  await rm(backupRoot, { recursive: true, force: true });
  let movedExistingSnapshot = false;
  try {
    await rename(destinationRoot, backupRoot);
    movedExistingSnapshot = true;
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) {
      throw error;
    }
  }

  try {
    await rename(stagingRoot, destinationRoot);
  } catch (error) {
    if (movedExistingSnapshot) {
      await rename(backupRoot, destinationRoot);
    }
    throw error;
  }
  await rm(backupRoot, { recursive: true, force: true });
}

async function main() {
  const commit = optionValue("commit");
  if (!/^[a-f0-9]{40}$/.test(commit ?? "")) {
    throw new Error("provide an exact WPT revision with --commit=<40-character-object-id>");
  }

  const acquired = await acquireSource(commit);
  let stagingRoot = null;
  try {
    const sourceResourceRoot = path.join(acquired.sourceRoot, WPT_RESOURCE_ROOT);
    const fixtureNames = (await readdir(sourceResourceRoot))
      .filter((fileName) => fileName.endsWith(".dat"))
      .sort(comparePaths);
    if (fixtureNames.length === 0) {
      throw new Error(`no .dat fixtures found under ${sourceResourceRoot}`);
    }

    const destinationRoot = path.resolve(WPT_TREE_CORPUS_ROOT);
    const destinationParent = path.dirname(destinationRoot);
    await mkdir(destinationParent, { recursive: true });
    stagingRoot = await mkdtemp(path.join(destinationParent, ".wpt-tree-refresh-"));
    await mkdir(path.join(stagingRoot, "resources"), { recursive: true });

    const sourceFiles = [
      { kind: "license", sourcePath: "LICENSE.md", path: "LICENSE.md" },
      {
        kind: "format",
        sourcePath: `${WPT_RESOURCE_ROOT}/README.md`,
        path: "resources/README.md"
      },
      ...fixtureNames.map((fileName) => ({
        kind: "fixture",
        sourcePath: `${WPT_RESOURCE_ROOT}/${fileName}`,
        path: `resources/${fileName}`
      }))
    ];

    const files = [];
    let baseCases = 0;
    let executionVariants = 0;
    for (const sourceFile of sourceFiles) {
      const sourcePath = path.join(acquired.sourceRoot, sourceFile.sourcePath);
      const destinationPath = path.join(stagingRoot, sourceFile.path);
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await cp(sourcePath, destinationPath);
      const bytes = await readFile(destinationPath);
      if (sourceFile.kind === "fixture") {
        const cases = parseTreeDatFixtures(bytes.toString("utf8"), sourceFile.path);
        baseCases += cases.length;
        executionVariants += expandTreeDatCases(cases).length;
      }
      files.push({
        kind: sourceFile.kind,
        path: sourceFile.path,
        upstreamPath: sourceFile.sourcePath,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        gitBlob: git(acquired.sourceRoot, ["rev-parse", `${commit}:${sourceFile.sourcePath}`])
      });
    }

    const canonicalLines = [...files]
      .sort((left, right) => comparePaths(left.path, right.path))
      .map((file) => `${file.sha256}  ${file.path}\n`)
      .join("");
    const fixtureBytes = files
      .filter((file) => file.kind === "fixture")
      .reduce((total, file) => total + file.bytes, 0);
    const manifest = {
      schemaVersion: 1,
      repository: WPT_REPOSITORY,
      commit,
      sourceRoot: WPT_RESOURCE_ROOT,
      license: "BSD-3-Clause",
      statistics: {
        fixtureFiles: fixtureNames.length,
        fixtureBytes,
        baseCases,
        executionVariants
      },
      files,
      compositeSha256: sha256(Buffer.from(canonicalLines, "utf8"))
    };
    await writeFile(
      path.join(stagingRoot, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );
    await replaceSnapshot(stagingRoot, destinationRoot);
    console.log(
      `Pinned WPT tree corpus ${commit}: files=${String(fixtureNames.length)} ` +
        `cases=${String(baseCases)} variants=${String(executionVariants)}`
    );
  } finally {
    if (stagingRoot !== null) {
      await rm(stagingRoot, { recursive: true, force: true });
    }
    await acquired.cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
