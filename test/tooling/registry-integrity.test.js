import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildExpectedJsrVersion,
  compareJsrVersionMetadata,
  compareNpmProvenanceStatement,
  compareNpmVersionMetadata
} from "../../scripts/release/registry-integrity.mjs";
import {
  resolveNpmVersionState,
  resolveVersionTagCommit,
  waitForRegistryState
} from "../../scripts/release/registry-state.mjs";

test("JSR registry verification owns the complete qualified source surface", async () => {
  const jsrManifest = JSON.parse(await readFile("jsr.json", "utf8"));
  const expected = await buildExpectedJsrVersion(process.cwd(), jsrManifest);
  const identical = globalThis.structuredClone(expected);
  assert.deepEqual(compareJsrVersionMetadata(identical, expected), {
    ok: true,
    failures: []
  });

  const firstPath = Object.keys(identical.manifest)[0];
  assert.notEqual(firstPath, undefined);
  identical.manifest[firstPath].checksum = "sha256-controlled-mismatch";
  identical.manifest["/unexpected.ts"] = {
    size: 1,
    checksum: "sha256-controlled-unexpected"
  };
  const comparison = compareJsrVersionMetadata(identical, expected);
  assert.equal(comparison.ok, false);
  assert.ok(comparison.failures.includes("manifest-paths"));
  assert.ok(comparison.failures.includes(`manifest-file:${firstPath}`));
});

test("npm registry verification requires the exact tarball and provenance", () => {
  const expected = {
    name: "@scope/package",
    version: "1.2.3",
    integrity: "sha512-exact"
  };
  const metadata = {
    name: expected.name,
    version: expected.version,
    dist: {
      integrity: expected.integrity,
      attestations: {
        provenance: { predicateType: "https://slsa.dev/provenance/v1" }
      }
    }
  };
  assert.deepEqual(compareNpmVersionMetadata(metadata, expected), {
    ok: true,
    failures: []
  });
  metadata.dist.integrity = "sha512-other";
  delete metadata.dist.attestations;
  assert.deepEqual(compareNpmVersionMetadata(metadata, expected), {
    ok: false,
    failures: ["integrity", "provenance"]
  });
});

test("npm provenance binds the artifact to the release workflow and source commit", () => {
  const expected = {
    name: "@scope/package",
    version: "1.2.3",
    sha512: "abc123",
    repository: "https://github.com/owner/repository",
    commit: "0123456789abcdef"
  };
  const statement = {
    subject: [{
      name: "pkg:npm/%40scope/package@1.2.3",
      digest: { sha512: expected.sha512 }
    }],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: expected.repository,
            path: ".github/workflows/publish.yml"
          }
        },
        internalParameters: { github: { event_name: "release" } },
        resolvedDependencies: [{
          uri: `git+${expected.repository}@refs/tags/v1.2.3`,
          digest: { gitCommit: expected.commit }
        }]
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" }
      }
    }
  };
  assert.deepEqual(compareNpmProvenanceStatement(statement, expected), {
    ok: true,
    failures: []
  });
  statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "other";
  statement.predicate.buildDefinition.internalParameters.github.event_name = "workflow_dispatch";
  assert.deepEqual(compareNpmProvenanceStatement(statement, expected), {
    ok: false,
    failures: ["event", "source-commit"]
  });
});

test("npm attestation propagation is transient but immutable mismatches are final", async () => {
  const expected = {
    name: "@scope/package",
    version: "1.2.3",
    integrity: "sha512-exact",
    sha512: "abc123",
    repository: "https://github.com/owner/repository",
    commit: "0123456789abcdef"
  };
  const metadata = {
    name: expected.name,
    version: expected.version,
    dist: {
      integrity: expected.integrity,
      attestations: {
        url: "https://registry.example/attestations",
        provenance: { predicateType: "https://slsa.dev/provenance/v1" }
      }
    }
  };
  const unavailable = await resolveNpmVersionState(metadata, expected, async () => ({
    ok: false,
    status: 404
  }));
  assert.deepEqual(unavailable, {
    state: "pending",
    failures: ["provenance-unavailable"]
  });

  metadata.dist.integrity = "sha512-other";
  let fetched = false;
  const mismatch = await resolveNpmVersionState(metadata, expected, async () => {
    fetched = true;
    throw new Error("must not fetch provenance after an immutable mismatch");
  });
  assert.deepEqual(mismatch, { state: "mismatch", failures: ["integrity"] });
  assert.equal(fetched, false);
});

test("registry polling backs off only for transient states", async () => {
  const observations = [
    { state: "absent", failures: [] },
    { state: "pending", failures: ["provenance-unavailable"] },
    { state: "identical", failures: [] }
  ];
  const delays = [];
  let time = 0;
  const result = await waitForRegistryState(
    async () => observations.shift(),
    {
      waitMilliseconds: 100,
      initialDelayMilliseconds: 10,
      maxDelayMilliseconds: 40,
      now: () => time,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        time += milliseconds;
      }
    }
  );
  assert.deepEqual(result, { state: "identical", failures: [] });
  assert.deepEqual(delays, [10, 20]);

  let reads = 0;
  const mismatch = await waitForRegistryState(
    async () => {
      reads += 1;
      return { state: "mismatch", failures: ["integrity"] };
    },
    { waitMilliseconds: 100 }
  );
  assert.deepEqual(mismatch, { state: "mismatch", failures: ["integrity"] });
  assert.equal(reads, 1);
});

test("publication delegates eventual consistency to the typed registry state", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/publish.yml", import.meta.url),
    "utf8"
  );
  assert.match(
    workflow,
    /--registry=jsr --require-present --wait-seconds=300/
  );
  assert.match(
    workflow,
    /--registry=npm --require-present --wait-seconds=300/
  );
  assert.doesNotMatch(workflow, /for attempt in \{1\.\.12\}/);
});

test("published provenance is bound to the version tag rather than current HEAD", async () => {
  let invocation;
  const commit = resolveVersionTagCommit("0.2.0", (...arguments_) => {
    invocation = arguments_;
    return "0123456789abcdef\n";
  });
  assert.equal(commit, "0123456789abcdef");
  assert.deepEqual(invocation, [
    "git",
    ["rev-parse", "--verify", "v0.2.0^{commit}"],
    { encoding: "utf8" }
  ]);
  assert.throws(() => resolveVersionTagCommit("0.2.0-next.1"), /invalid published version/);

  const auditWorkflow = await readFile(
    new URL("../../.github/workflows/release-audit.yml", import.meta.url),
    "utf8"
  );
  assert.match(auditWorkflow, /fetch-depth: 0/);
  assert.match(auditWorkflow, /fetch-tags: true/);
});
