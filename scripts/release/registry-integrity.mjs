import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const EXPECTED_JSR_INCLUDE = Object.freeze([
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "THIRD_PARTY_NOTICES.md",
  "docs/*.md",
  "jsr/mod.ts",
  "src/**/*.ts"
]);
const JSR_ROOT_FILES = Object.freeze([
  "jsr.json",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "THIRD_PARTY_NOTICES.md",
  "jsr/mod.ts"
]);
const NPM_PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";

function exactStringSet(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

async function collectFiles(root, directory, recursive, suffix) {
  const absoluteDirectory = path.join(root, directory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(directory, entry.name);
    if (entry.isDirectory() && recursive) {
      files.push(...await collectFiles(root, relativePath, true, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(relativePath);
    }
  }
  return files;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Builds the exact raw-file manifest expected from the enforced JSR surface. */
export async function buildExpectedJsrVersion(root, jsrManifest) {
  const includes = jsrManifest.publish?.include ?? [];
  if (!exactStringSet(includes, EXPECTED_JSR_INCLUDE)) {
    throw new Error("JSR registry verification requires the qualified include policy");
  }

  const files = [...new Set([
    ...JSR_ROOT_FILES,
    ...await collectFiles(root, "docs", false, ".md"),
    ...await collectFiles(root, "src", true, ".ts")
  ])].sort();
  const manifest = {};
  for (const file of files) {
    const bytes = await readFile(path.join(root, file));
    manifest[`/${file}`] = {
      size: bytes.byteLength,
      checksum: `sha256-${sha256(bytes)}`
    };
  }
  return Object.freeze({
    exports: jsrManifest.exports,
    manifest: Object.freeze(manifest)
  });
}

/** Compares immutable JSR metadata to the complete expected publication. */
export function compareJsrVersionMetadata(metadata, expected) {
  const failures = [];
  if (JSON.stringify(metadata?.exports) !== JSON.stringify(expected.exports)) {
    failures.push("exports");
  }
  const actualManifest = metadata?.manifest;
  if (actualManifest === null || typeof actualManifest !== "object") {
    failures.push("manifest");
    return Object.freeze({ ok: false, failures: Object.freeze(failures) });
  }

  const expectedPaths = Object.keys(expected.manifest).sort();
  const actualPaths = Object.keys(actualManifest).sort();
  if (!exactStringSet(actualPaths, expectedPaths)) failures.push("manifest-paths");
  for (const file of expectedPaths) {
    const expectedFile = expected.manifest[file];
    const actualFile = actualManifest[file];
    if (
      actualFile?.size !== expectedFile?.size ||
      actualFile?.checksum !== expectedFile?.checksum
    ) {
      failures.push(`manifest-file:${file}`);
    }
  }
  return Object.freeze({
    ok: failures.length === 0,
    failures: Object.freeze(failures)
  });
}

/** Compares immutable npm metadata to the exact qualified tarball. */
export function compareNpmVersionMetadata(metadata, expected) {
  const failures = [];
  if (metadata?.name !== expected.name) failures.push("name");
  if (metadata?.version !== expected.version) failures.push("version");
  if (metadata?.dist?.integrity !== expected.integrity) failures.push("integrity");
  if (metadata?.dist?.attestations?.provenance?.predicateType !== NPM_PROVENANCE_PREDICATE) {
    failures.push("provenance");
  }
  return Object.freeze({
    ok: failures.length === 0,
    failures: Object.freeze(failures)
  });
}

/** Verifies that npm provenance binds the exact artifact to the exact source revision. */
export function compareNpmProvenanceStatement(statement, expected) {
  const failures = [];
  const expectedSubject = `pkg:npm/${expected.name.replace(/^@/u, "%40")}@${expected.version}`;
  const subject = statement?.subject?.find((entry) => entry?.name === expectedSubject);
  if (subject?.digest?.sha512 !== expected.sha512) failures.push("subject");

  const buildDefinition = statement?.predicate?.buildDefinition;
  const workflow = buildDefinition?.externalParameters?.workflow;
  if (workflow?.repository !== expected.repository) failures.push("workflow-repository");
  if (workflow?.path !== ".github/workflows/publish.yml") failures.push("workflow-path");
  if (buildDefinition?.internalParameters?.github?.event_name !== "release") {
    failures.push("event");
  }
  const resolvedDependencies = buildDefinition?.resolvedDependencies;
  if (!Array.isArray(resolvedDependencies) || !resolvedDependencies.some((dependency) =>
    dependency?.digest?.gitCommit === expected.commit &&
    typeof dependency?.uri === "string" &&
    dependency.uri.startsWith(`git+${expected.repository}@`)
  )) {
    failures.push("source-commit");
  }
  if (statement?.predicate?.runDetails?.builder?.id !==
      "https://github.com/actions/runner/github-hosted") {
    failures.push("builder");
  }
  return Object.freeze({
    ok: failures.length === 0,
    failures: Object.freeze(failures)
  });
}
