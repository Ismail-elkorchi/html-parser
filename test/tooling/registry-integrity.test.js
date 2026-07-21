import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildExpectedJsrVersion,
  compareJsrVersionMetadata,
  compareNpmProvenanceStatement,
  compareNpmVersionMetadata
} from "../../scripts/release/registry-integrity.mjs";

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
