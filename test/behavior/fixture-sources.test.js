import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_HTML5LIB_FIXTURE_FILES,
  requireFixtureFiles
} from "../support/fixture-sources.mjs";

test("fixture inventory accepts every consumed html5lib source", async () => {
  await requireFixtureFiles(ALL_HTML5LIB_FIXTURE_FILES);
});

test("missing fixture data fails with exact paths and recovery guidance", async () => {
  const missing = "tmp/qual-01-intentionally-missing-fixture.dat";
  await assert.rejects(
    requireFixtureFiles([missing]),
    (error) =>
      error instanceof Error &&
      error.message.includes(missing) &&
      error.message.includes("git submodule update --init --recursive")
  );
});
