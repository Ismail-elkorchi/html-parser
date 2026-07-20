import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const HTML5LIB_REPOSITORY = "https://github.com/html5lib/html5lib-tests.git";
const CORPORA = Object.freeze([
  Object.freeze({
    id: "tokenizer",
    sourceRoot: "tokenizer",
    destinationRoot: "test/fixtures/upstream/html5lib-tokenizer",
    extension: ".test",
    expectedFixtureFiles: 14,
    supportingFiles: Object.freeze([
      Object.freeze({ kind: "format", sourcePath: "tokenizer/README.md", path: "README.md" })
    ])
  }),
  Object.freeze({
    id: "encoding",
    sourceRoot: "encoding",
    destinationRoot: "test/fixtures/upstream/html5lib-encoding",
    extension: ".dat",
    expectedFixtureFiles: 3,
    supportingFiles: Object.freeze([])
  })
]);

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

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "html-parser-html5lib-refresh-"));
  execFileSync("git", ["init", "--quiet", temporaryRoot], { stdio: "inherit" });
  git(temporaryRoot, ["remote", "add", "origin", HTML5LIB_REPOSITORY]);
  git(temporaryRoot, ["config", "core.sparseCheckout", "true"]);
  await writeFile(
    path.join(temporaryRoot, ".git", "info", "sparse-checkout"),
    "/LICENSE\n/tokenizer/\n/encoding/\n",
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

async function buildCorpusSnapshot(sourceRoot, commit, corpus, stagingRoot) {
  const sourceDirectory = path.join(sourceRoot, corpus.sourceRoot);
  const fixtureNames = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(corpus.extension))
    .map((entry) => entry.name)
    .sort(comparePaths);
  if (fixtureNames.length !== corpus.expectedFixtureFiles) {
    throw new Error(
      `${corpus.id} fixture inventory changed: expected ${String(corpus.expectedFixtureFiles)}, ` +
        `found ${String(fixtureNames.length)}; review the upstream additions or removals first`
    );
  }

  await mkdir(stagingRoot, { recursive: true });
  const sourceFiles = [
    { kind: "license", sourcePath: "LICENSE", path: "LICENSE" },
    ...corpus.supportingFiles,
    ...fixtureNames.map((fileName) => ({
      kind: "fixture",
      sourcePath: `${corpus.sourceRoot}/${fileName}`,
      path: fileName
    }))
  ];

  const files = [];
  for (const sourceFile of sourceFiles) {
    const sourcePath = path.join(sourceRoot, sourceFile.sourcePath);
    const destinationPath = path.join(stagingRoot, sourceFile.path);
    await cp(sourcePath, destinationPath);
    const bytes = await readFile(destinationPath);
    files.push({
      kind: sourceFile.kind,
      path: sourceFile.path,
      upstreamPath: sourceFile.sourcePath,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      gitBlob: git(sourceRoot, ["rev-parse", `${commit}:${sourceFile.sourcePath}`])
    });
  }

  const canonicalLines = [...files]
    .sort((left, right) => comparePaths(left.path, right.path))
    .map((file) => `${file.sha256}  ${file.path}\n`)
    .join("");
  const fixtureFiles = files.filter((file) => file.kind === "fixture");
  const manifest = {
    schemaVersion: 1,
    corpus: corpus.id,
    repository: HTML5LIB_REPOSITORY,
    commit,
    sourceRoot: corpus.sourceRoot,
    license: "MIT",
    statistics: {
      fixtureFiles: fixtureFiles.length,
      fixtureBytes: fixtureFiles.reduce((total, file) => total + file.bytes, 0)
    },
    files,
    compositeSha256: sha256(Buffer.from(canonicalLines, "utf8"))
  };
  await writeFile(
    path.join(stagingRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

async function main() {
  const commit = optionValue("commit");
  if (!/^[a-f0-9]{40}$/.test(commit ?? "")) {
    throw new Error("provide an exact html5lib-tests revision with --commit=<40-character-object-id>");
  }

  const acquired = await acquireSource(commit);
  const destinationParent = path.resolve("test/fixtures/upstream");
  await mkdir(destinationParent, { recursive: true });
  const stagingParent = await mkdtemp(path.join(destinationParent, ".html5lib-refresh-"));
  try {
    for (const corpus of CORPORA) {
      await buildCorpusSnapshot(
        acquired.sourceRoot,
        commit,
        corpus,
        path.join(stagingParent, corpus.id)
      );
    }
    for (const corpus of CORPORA) {
      const destinationRoot = path.resolve(corpus.destinationRoot);
      await mkdir(path.dirname(destinationRoot), { recursive: true });
      await replaceSnapshot(path.join(stagingParent, corpus.id), destinationRoot);
    }
    console.log(
      `Pinned html5lib test corpora ${commit}: tokenizer=14 files, encoding=3 files`
    );
  } finally {
    await rm(stagingParent, { recursive: true, force: true });
    await acquired.cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
