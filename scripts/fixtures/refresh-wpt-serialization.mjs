import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseLongOptions } from "../lib/cli.mjs";
import { sha256 } from "../lib/report.mjs";
import {
  acquirePinnedGitSource,
  assertCommit,
  comparePaths,
  git,
  replacePathsAtomically
} from "../lib/upstream-snapshot.mjs";

const WPT_REPOSITORY = "https://github.com/web-platform-tests/wpt.git";
const WPT_SOURCE_ROOT = "html/syntax/serializing-html-fragments";
const DESTINATION_ROOT = "test/fixtures/upstream/wpt-serialization";

const APPLICABILITY = Object.freeze({
  "escaping.html": {
    status: "partial",
    reason: "static noscript serialization expectations apply; document.write, XHR, and execution setup do not"
  },
  "initial-linefeed-pre.html": { status: "applicable" },
  "outerHTML.html": { status: "applicable" },
  "processing-instructions.html": { status: "applicable" },
  "range-on-pi-contextual-fragment-crash.html": {
    status: "inapplicable",
    reason: "the package does not expose DOM Range or createContextualFragment"
  },
  "serializing-cdata-in-html-document.html": { status: "applicable" },
  "serializing-lt-gt.html": { status: "applicable" },
  "serializing.html": { status: "applicable" },
  "template.html": { status: "applicable" }
});

async function main() {
  const options = parseLongOptions(process.argv.slice(2), {
    commit: { type: "string", required: true },
    source: { type: "string" }
  }, "refresh WPT serialization fixtures");
  const commit = assertCommit(options.commit, "--commit");
  const acquired = await acquirePinnedGitSource({
    repository: WPT_REPOSITORY,
    commit,
    source: options.source,
    sparsePaths: ["LICENSE.md", "html/resources/common.js", `${WPT_SOURCE_ROOT}/`],
    temporaryPrefix: "html-parser-wpt-serialization-refresh-"
  });
  let stagingRoot = null;
  try {
    const sourceDirectory = path.join(acquired.sourceRoot, WPT_SOURCE_ROOT);
    const fixtureNames = (await readdir(sourceDirectory))
      .filter((fileName) => fileName.endsWith(".html"))
      .sort(comparePaths);
    const expectedNames = Object.keys(APPLICABILITY).sort(comparePaths);
    if (JSON.stringify(fixtureNames) !== JSON.stringify(expectedNames)) {
      throw new Error("WPT serialization inventory changed; review applicability before refreshing");
    }

    const destinationRoot = path.resolve(DESTINATION_ROOT);
    await mkdir(path.dirname(destinationRoot), { recursive: true });
    stagingRoot = await mkdtemp(path.join(path.dirname(destinationRoot), ".wpt-serialization-refresh-"));
    await mkdir(path.join(stagingRoot, "files"), { recursive: true });
    await mkdir(path.join(stagingRoot, "dependencies"), { recursive: true });

    const sources = [
      { kind: "license", sourcePath: "LICENSE.md", outputPath: "LICENSE.md" },
      {
        kind: "dependency",
        sourcePath: "html/resources/common.js",
        outputPath: "dependencies/html-common.js"
      },
      ...fixtureNames.map((fileName) => ({
        kind: "fixture",
        sourcePath: `${WPT_SOURCE_ROOT}/${fileName}`,
        outputPath: `files/${fileName}`,
        applicability: APPLICABILITY[fileName]
      }))
    ];
    const files = [];
    for (const source of sources) {
      const destinationPath = path.join(stagingRoot, source.outputPath);
      await cp(path.join(acquired.sourceRoot, source.sourcePath), destinationPath);
      const bytes = await readFile(destinationPath);
      files.push({
        kind: source.kind,
        path: source.outputPath,
        upstreamPath: source.sourcePath,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        gitBlob: git(acquired.sourceRoot, ["rev-parse", `${commit}:${source.sourcePath}`]),
        ...(source.applicability === undefined ? {} : { applicability: source.applicability })
      });
    }

    const canonicalLines = [...files]
      .sort((left, right) => comparePaths(left.path, right.path))
      .map((file) => `${file.sha256}  ${file.path}\n`)
      .join("");
    const fixtures = files.filter((file) => file.kind === "fixture");
    const manifest = {
      schemaVersion: 1,
      repository: WPT_REPOSITORY,
      commit,
      sourceRoot: WPT_SOURCE_ROOT,
      license: "BSD-3-Clause",
      statistics: {
        fixtureFiles: fixtures.length,
        fixtureBytes: fixtures.reduce((total, file) => total + file.bytes, 0),
        applicableFiles: fixtures.filter((file) => file.applicability?.status === "applicable").length,
        partialFiles: fixtures.filter((file) => file.applicability?.status === "partial").length,
        inapplicableFiles: fixtures.filter((file) => file.applicability?.status === "inapplicable").length
      },
      files,
      compositeSha256: sha256(Buffer.from(canonicalLines, "utf8")),
      applicabilitySha256: sha256(Buffer.from(JSON.stringify(
        fixtures.map((file) => ({ path: file.path, applicability: file.applicability }))
      ), "utf8"))
    };
    await writeFile(path.join(stagingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await replacePathsAtomically([{ source: stagingRoot, destination: destinationRoot }]);
    stagingRoot = null;
    console.log(
      `Pinned WPT serialization corpus ${commit}: files=${String(fixtures.length)} ` +
        `bytes=${String(manifest.statistics.fixtureBytes)}`
    );
  } finally {
    if (stagingRoot !== null) await rm(stagingRoot, { recursive: true, force: true });
    await acquired.cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
