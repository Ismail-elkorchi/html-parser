import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadVisibleTextFixtures,
  VisibleTextFixtureError,
  VISIBLE_TEXT_FIXTURES_PATH
} from "../support/visible-text-fixtures.mjs";

test("visible-text fixture validation rejects duplicate case identities", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "html-parser-visible-text-"));
  try {
    const destination = path.join(repositoryRoot, VISIBLE_TEXT_FIXTURES_PATH);
    await mkdir(path.dirname(destination), { recursive: true });
    const corpus = JSON.parse(await readFile(VISIBLE_TEXT_FIXTURES_PATH, "utf8"));
    corpus.visibleText[1].id = corpus.visibleText[0].id;
    await writeFile(destination, `${JSON.stringify(corpus)}\n`, "utf8");

    await assert.rejects(
      loadVisibleTextFixtures({ repositoryRoot }),
      (error) => error instanceof VisibleTextFixtureError &&
        error.message.includes("duplicate id")
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
