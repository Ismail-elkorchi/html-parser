import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  verifyWptTreeCorpus,
  WptTreeCorpusError,
  WPT_TREE_CORPUS_ROOT
} from "../../scripts/conformance/wpt-tree-corpus.mjs";

const EXPECTED_COMMIT = "e4ea1706fa708c3ac4523c534a65160d1ab20db8";
const EXPECTED_COMPOSITE = "9bf2315b5c8836b0d1bc7375cbabc746f9891735dc958491b99a1855b7cb2acc";

test("WPT tree corpus matches its exact offline provenance manifest", async () => {
  const result = await verifyWptTreeCorpus();
  assert.equal(result.manifest.commit, EXPECTED_COMMIT);
  assert.equal(result.compositeSha256, EXPECTED_COMPOSITE);
  assert.equal(result.manifest.statistics.fixtureFiles, 61);
  assert.equal(result.manifest.statistics.fixtureBytes, 470005);
  assert.equal(result.manifest.statistics.baseCases, 1934);
  assert.equal(result.manifest.statistics.executionVariants, 3828);
});

test("WPT tree corpus gate rejects a controlled fixture mutation", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "html-parser-wpt-corpus-"));
  try {
    const copiedRoot = path.join(repositoryRoot, WPT_TREE_CORPUS_ROOT);
    await cp(WPT_TREE_CORPUS_ROOT, copiedRoot, { recursive: true });
    const target = path.join(copiedRoot, "resources", "tests1.dat");
    const bytes = await readFile(target);
    bytes[0] ^= 1;
    await writeFile(target, bytes);

    await assert.rejects(
      verifyWptTreeCorpus({ repositoryRoot }),
      (error) => {
        assert(error instanceof WptTreeCorpusError);
        assert(error.problems.some((problem) => problem.includes("SHA-256 mismatch")));
        return true;
      }
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
