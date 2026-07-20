import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ENCODING_FIXTURES,
  Html5libCorpusError,
  TOKENIZER_FIXTURES,
  verifyHtml5libCorpora
} from "../support/html5lib-corpora.mjs";

test("checked-in html5lib corpora match their exact manifests", async () => {
  const corpus = await verifyHtml5libCorpora();
  assert.equal(TOKENIZER_FIXTURES.length, 14);
  assert.equal(ENCODING_FIXTURES.length, 3);
  assert.equal(TOKENIZER_FIXTURES.length + ENCODING_FIXTURES.length, 17);
  assert.equal(corpus.commit, "224991ec10db04f056a89eed8b0bd8695fd2950e");
});

test("missing checked-in corpus data fails with its corpus identity", async () => {
  await assert.rejects(
    verifyHtml5libCorpora({ repositoryRoot: "tmp/intentionally-missing-corpus-root" }),
    (error) =>
      error instanceof Error &&
      error.message.includes("cannot read test/fixtures/upstream/html5lib-tokenizer/manifest.json")
  );
});

test("html5lib corpus verification rejects a controlled fixture mutation", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "html-parser-html5lib-corpora-"));
  try {
    const upstreamRoot = path.join(repositoryRoot, "test", "fixtures", "upstream");
    await mkdir(upstreamRoot, { recursive: true });
    await cp(
      "test/fixtures/upstream/html5lib-tokenizer",
      path.join(upstreamRoot, "html5lib-tokenizer"),
      { recursive: true }
    );
    await cp(
      "test/fixtures/upstream/html5lib-encoding",
      path.join(upstreamRoot, "html5lib-encoding"),
      { recursive: true }
    );
    const target = path.join(upstreamRoot, "html5lib-tokenizer", "pendingSpecChanges.test");
    const bytes = await readFile(target);
    bytes[0] ^= 1;
    await writeFile(target, bytes);

    await assert.rejects(
      verifyHtml5libCorpora({ repositoryRoot }),
      (error) => {
        assert(error instanceof Html5libCorpusError);
        assert(error.problems.some((problem) => problem.includes("SHA-256 mismatch")));
        return true;
      }
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
