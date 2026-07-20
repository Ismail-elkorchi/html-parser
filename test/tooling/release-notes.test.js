import assert from "node:assert/strict";
import test from "node:test";

import {
  parseReleaseCliArgs,
  parseRepoFromRemote
} from "../../scripts/release/notes-lib.mjs";
import { updateUnreleasedSection } from "../../scripts/release/update-changelog.mjs";

test("release repository coordinates support SSH and HTTPS remotes", () => {
  assert.deepEqual(parseRepoFromRemote("git@github.com:owner/repository.git"), {
    owner: "owner",
    repo: "repository"
  });
  assert.deepEqual(parseRepoFromRemote("https://github.com/owner/repository.git"), {
    owner: "owner",
    repo: "repository"
  });
  assert.throws(() => parseRepoFromRemote("https://example.com/owner/repository.git"));
});

test("release options reject obsolete aliases, missing values, and unknown flags", () => {
  assert.deepEqual(parseReleaseCliArgs([
    "--dry-run",
    "--from-tag=v0.1.1",
    "--to-ref",
    "main",
    "--changelog=NEXT.md"
  ]), {
    dryRun: true,
    fromTag: "v0.1.1",
    toRef: "main",
    changelogPath: "NEXT.md"
  });
  assert.throws(() => parseReleaseCliArgs(["--from_tag=v0.1.1"]), /unsupported option/);
  assert.throws(() => parseReleaseCliArgs(["--to-ref"]), /requires a value/);
});

test("changelog updates retain one generated Changes block", () => {
  const initial = "# Changelog\n\n## Unreleased\n\nExisting note.\n\n## 0.1.1\n";
  const once = updateUnreleasedSection(initial, "### Changes (v0.1.1...main)\n- One");
  const twice = updateUnreleasedSection(once, "### Changes (v0.1.1...main)\n- Two");
  assert.match(twice, /### Changes \(v0\.1\.1\.\.\.main\)\n- Two/);
  assert.doesNotMatch(twice, /- One/);
  assert.equal((twice.match(/release-notes:start/g) ?? []).length, 1);
});
