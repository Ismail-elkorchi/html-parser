import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseLongOptions } from "../lib/cli.mjs";
import { sha256 } from "../lib/report.mjs";
import {
  acquirePinnedGitSource,
  assertCommit,
  comparePaths,
  git,
  inventoryDifference,
  replacePathsAtomically
} from "../lib/upstream-snapshot.mjs";

const HTML5LIB_REPOSITORY = "https://github.com/html5lib/html5lib-tests.git";
const CORPORA = Object.freeze([
  Object.freeze({
    id: "tokenizer",
    sourceRoot: "tokenizer",
    destinationRoot: "test/fixtures/upstream/html5lib-tokenizer",
    extension: ".test",
    supportingFiles: Object.freeze([
      Object.freeze({ kind: "format", sourcePath: "tokenizer/README.md", path: "README.md" })
    ])
  }),
  Object.freeze({
    id: "encoding",
    sourceRoot: "encoding",
    destinationRoot: "test/fixtures/upstream/html5lib-encoding",
    extension: ".dat",
    supportingFiles: Object.freeze([])
  })
]);

async function reviewedFixtureNames(corpus) {
  const manifestPath = path.join(corpus.destinationRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.files)) {
    throw new Error(`${corpus.id} manifest has no reviewed file inventory`);
  }
  return manifest.files
    .filter((file) => file?.kind === "fixture")
    .map((file) => file.path)
    .sort(comparePaths);
}

async function buildCorpusSnapshot(sourceRoot, commit, corpus, stagingRoot, acceptInventoryChange) {
  const sourceDirectory = path.join(sourceRoot, corpus.sourceRoot);
  const fixtureNames = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(corpus.extension))
    .map((entry) => entry.name)
    .sort(comparePaths);
  const inventory = inventoryDifference(await reviewedFixtureNames(corpus), fixtureNames);
  if ((inventory.added.length > 0 || inventory.removed.length > 0) && !acceptInventoryChange) {
    throw new Error(
      `${corpus.id} fixture inventory changed: added=[${inventory.added.join(", ")}], ` +
        `removed=[${inventory.removed.join(", ")}]; review it and rerun with ` +
        "--accept-inventory-change"
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
  return fixtureNames.length;
}

async function main() {
  const options = parseLongOptions(process.argv.slice(2), {
    commit: { type: "string", required: true },
    source: { type: "string" },
    "accept-inventory-change": { type: "boolean", default: false }
  }, "refresh html5lib fixtures");
  const commit = assertCommit(options.commit, "--commit");
  const acquired = await acquirePinnedGitSource({
    repository: HTML5LIB_REPOSITORY,
    commit,
    source: options.source,
    sparsePaths: ["LICENSE", "tokenizer/", "encoding/"],
    temporaryPrefix: "html-parser-html5lib-refresh-"
  });
  const destinationParent = path.resolve("test/fixtures/upstream");
  await mkdir(destinationParent, { recursive: true });
  const stagingParent = await mkdtemp(path.join(destinationParent, ".html5lib-refresh-"));
  try {
    const refreshed = [];
    for (const corpus of CORPORA) {
      const fixtureFiles = await buildCorpusSnapshot(
        acquired.sourceRoot,
        commit,
        corpus,
        path.join(stagingParent, corpus.id),
        options["accept-inventory-change"]
      );
      refreshed.push(`${corpus.id}=${String(fixtureFiles)}`);
    }
    await replacePathsAtomically(CORPORA.map((corpus) => ({
      source: path.join(stagingParent, corpus.id),
      destination: path.resolve(corpus.destinationRoot)
    })));
    console.log(
      `Pinned html5lib test corpora ${commit}: ${refreshed.join(", ")}`
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
