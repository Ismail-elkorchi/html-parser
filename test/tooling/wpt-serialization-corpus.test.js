import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  verifyWptSerializationCorpus,
  WptSerializationCorpusError,
  WPT_SERIALIZATION_CORPUS_ROOT
} from "../support/wpt-serialization-corpus.mjs";

const EXPECTED_COMMIT = "e4ea1706fa708c3ac4523c534a65160d1ab20db8";
const EXPECTED_COMPOSITE = "2d6598ba727a8af2b0b1d500aa089096cc878db88a97172e96d45a88540dea57";
const EXPECTED_APPLICABILITY = "2bd9fb64278e59092b38de3d6ebca4b245fdb38b55ae39907dd1e53fef57925a";

test("WPT serialization corpus matches its exact offline provenance manifest", async () => {
  const result = await verifyWptSerializationCorpus();
  assert.equal(result.manifest.commit, EXPECTED_COMMIT);
  assert.equal(result.compositeSha256, EXPECTED_COMPOSITE);
  assert.equal(result.applicabilitySha256, EXPECTED_APPLICABILITY);
  assert.deepEqual(result.manifest.statistics, {
    fixtureFiles: 9,
    fixtureBytes: 21642,
    applicableFiles: 7,
    partialFiles: 1,
    inapplicableFiles: 1
  });
});

test("WPT serialization corpus gate rejects a controlled applicability change", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "html-parser-wpt-applicability-"));
  try {
    const copiedRoot = path.join(repositoryRoot, WPT_SERIALIZATION_CORPUS_ROOT);
    await cp(WPT_SERIALIZATION_CORPUS_ROOT, copiedRoot, { recursive: true });
    const manifestPath = path.join(copiedRoot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files.find((file) => file.path === "files/escaping.html").applicability.reason = "changed";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await assert.rejects(
      verifyWptSerializationCorpus({ repositoryRoot }),
      (error) => error instanceof WptSerializationCorpusError &&
        error.problems.includes("applicability SHA-256 mismatch")
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("WPT serialization corpus gate rejects a controlled fixture mutation", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "html-parser-wpt-serialization-"));
  try {
    const copiedRoot = path.join(repositoryRoot, WPT_SERIALIZATION_CORPUS_ROOT);
    await cp(WPT_SERIALIZATION_CORPUS_ROOT, copiedRoot, { recursive: true });
    const target = path.join(copiedRoot, "files", "serializing.html");
    const bytes = await readFile(target);
    bytes[0] ^= 1;
    await writeFile(target, bytes);
    await assert.rejects(
      verifyWptSerializationCorpus({ repositoryRoot }),
      (error) => error instanceof WptSerializationCorpusError &&
        error.problems.some((problem) => problem.includes("SHA-256 mismatch"))
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
