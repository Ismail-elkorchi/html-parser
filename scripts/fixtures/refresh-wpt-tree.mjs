import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expandTreeDatCases, parseTreeDatFixtures } from "../../test/support/tree-dat.mjs";
import { WPT_TREE_CORPUS_ROOT } from "../../test/support/wpt-tree-corpus.mjs";
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

const WPT_REPOSITORY = "https://github.com/web-platform-tests/wpt.git";
const WPT_RESOURCE_ROOT = "html/syntax/parsing/resources";

async function main() {
  const options = parseLongOptions(process.argv.slice(2), {
    commit: { type: "string", required: true },
    source: { type: "string" },
    "accept-inventory-change": { type: "boolean", default: false }
  }, "refresh WPT tree fixtures");
  const commit = assertCommit(options.commit, "--commit");
  const acquired = await acquirePinnedGitSource({
    repository: WPT_REPOSITORY,
    commit,
    source: options.source,
    sparsePaths: ["LICENSE.md", `${WPT_RESOURCE_ROOT}/`],
    temporaryPrefix: "html-parser-wpt-tree-refresh-"
  });
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
    const currentManifest = JSON.parse(await readFile(
      path.join(destinationRoot, "manifest.json"),
      "utf8"
    ));
    if (!Array.isArray(currentManifest.files)) {
      throw new Error("WPT tree manifest has no reviewed file inventory");
    }
    const reviewedNames = currentManifest.files
      .filter((file) => file?.kind === "fixture")
      .map((file) => path.basename(file.path))
      .sort(comparePaths);
    const inventory = inventoryDifference(reviewedNames, fixtureNames);
    if ((inventory.added.length > 0 || inventory.removed.length > 0) &&
        !options["accept-inventory-change"]) {
      throw new Error(
        `WPT tree fixture inventory changed: added=[${inventory.added.join(", ")}], ` +
          `removed=[${inventory.removed.join(", ")}]; review it and rerun with ` +
          "--accept-inventory-change"
      );
    }
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
    await replacePathsAtomically([{ source: stagingRoot, destination: destinationRoot }]);
    stagingRoot = null;
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
