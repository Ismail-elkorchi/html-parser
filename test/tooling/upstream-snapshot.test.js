import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCommit,
  inventoryDifference,
  replacePathsAtomically
} from "../../scripts/lib/upstream-snapshot.mjs";

test("exact upstream revisions reject abbreviated and uppercase object IDs", () => {
  assert.equal(assertCommit("a".repeat(40)), "a".repeat(40));
  assert.throws(() => assertCommit("a".repeat(39)), /40-character/);
  assert.throws(() => assertCommit("A".repeat(40)), /40-character/);
});

test("fixture inventory comparison exposes exact additions and removals", () => {
  assert.deepEqual(inventoryDifference(["a.dat", "b.dat"], ["b.dat", "c.dat"]), {
    added: ["c.dat"],
    removed: ["a.dat"]
  });
  assert.throws(() => inventoryDifference(["a.dat", "a.dat"], []), /duplicate paths/);
});

test("multi-path replacement restores every destination after a controlled failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "html-parser-snapshot-transaction-"));
  try {
    const firstDestination = path.join(root, "first");
    const secondDestination = path.join(root, "second");
    const firstSource = path.join(root, "first-next");
    await Promise.all([
      mkdir(firstDestination),
      mkdir(secondDestination),
      mkdir(firstSource)
    ]);
    await Promise.all([
      writeFile(path.join(firstDestination, "value"), "first-old"),
      writeFile(path.join(secondDestination, "value"), "second-old"),
      writeFile(path.join(firstSource, "value"), "first-new")
    ]);

    await assert.rejects(replacePathsAtomically([
      { source: firstSource, destination: firstDestination },
      { source: path.join(root, "missing-source"), destination: secondDestination }
    ]));
    assert.equal(await readFile(path.join(firstDestination, "value"), "utf8"), "first-old");
    assert.equal(await readFile(path.join(secondDestination, "value"), "utf8"), "second-old");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
