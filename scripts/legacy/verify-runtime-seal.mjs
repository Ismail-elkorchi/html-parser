import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const LEGACY_RUNTIME_MANIFEST_PATH = "legacy-runtime-manifest.json";

export class LegacyRuntimeSealError extends Error {
  constructor(problems) {
    super(`Legacy runtime seal verification failed:\n- ${problems.join("\n- ")}`);
    this.name = "LegacyRuntimeSealError";
    this.problems = Object.freeze([...problems]);
  }
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function collectRuntimeEntries(runtimeRoot) {
  const entries = [];

  async function walk(directory, relativeDirectory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      const relativePath = normalizePath(path.join(relativeDirectory, child.name));
      if (child.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else {
        entries.push({
          absolutePath,
          relativePath,
          kind: child.isFile() ? "file" : child.isSymbolicLink() ? "symbolic-link" : "other"
        });
      }
    }
  }

  await walk(runtimeRoot, "");
  return entries;
}

function validateManifestShape(manifest) {
  const problems = [];
  if (manifest?.schemaVersion !== 1) {
    problems.push("manifest schemaVersion must be 1");
  }
  if (typeof manifest?.sealedRoot !== "string" || manifest.sealedRoot.length === 0) {
    problems.push("manifest sealedRoot must be a non-empty string");
  }
  if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
    problems.push("manifest files must be a non-empty array");
  }
  if (manifest?.composite?.algorithm !== "sha256") {
    problems.push("manifest composite algorithm must be sha256");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest?.composite?.sha256 ?? "")) {
    problems.push("manifest composite SHA-256 is invalid");
  }
  return problems;
}

export async function verifyLegacyRuntimeSeal(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const manifestPath = path.resolve(
    repositoryRoot,
    options.manifestPath ?? LEGACY_RUNTIME_MANIFEST_PATH
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const problems = validateManifestShape(manifest);
  if (problems.length > 0) {
    throw new LegacyRuntimeSealError(problems);
  }

  const sealedRoot = normalizePath(manifest.sealedRoot).replace(/\/$/, "");
  const runtimeRoot = path.resolve(repositoryRoot, options.runtimeRoot ?? sealedRoot);
  const expectedByPath = new Map();

  for (const file of manifest.files) {
    const filePath = normalizePath(file?.path ?? "");
    if (!filePath.startsWith(`${sealedRoot}/`)) {
      problems.push(`manifest path is outside ${sealedRoot}: ${filePath || "<empty>"}`);
      continue;
    }
    if (expectedByPath.has(filePath)) {
      problems.push(`manifest path is duplicated: ${filePath}`);
      continue;
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      problems.push(`manifest byte count is invalid: ${filePath}`);
    }
    if (!/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) {
      problems.push(`manifest SHA-256 is invalid: ${filePath}`);
    }
    if (file.relation === "identical" && file.sha256 !== file.upstreamSha256) {
      problems.push(`identical provenance hashes disagree: ${filePath}`);
    }
    if (file.relation === "locally-modified" && file.sha256 === file.upstreamSha256) {
      problems.push(`locally modified provenance hashes unexpectedly agree: ${filePath}`);
    }
    expectedByPath.set(filePath, file);
  }

  let runtimeEntries;
  try {
    runtimeEntries = await collectRuntimeEntries(runtimeRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LegacyRuntimeSealError([...problems, `cannot inventory ${runtimeRoot}: ${message}`]);
  }

  const actualByPath = new Map();
  for (const entry of runtimeEntries) {
    const canonicalPath = `${sealedRoot}/${entry.relativePath}`;
    if (entry.kind !== "file") {
      problems.push(`${canonicalPath} is ${entry.kind}; only regular files are allowed`);
      continue;
    }
    const bytes = await readFile(entry.absolutePath);
    actualByPath.set(canonicalPath, {
      bytes: bytes.byteLength,
      sha256: sha256(bytes)
    });
  }

  for (const expectedPath of expectedByPath.keys()) {
    if (!actualByPath.has(expectedPath)) {
      problems.push(`missing file: ${expectedPath}`);
    }
  }
  for (const actualPath of actualByPath.keys()) {
    if (!expectedByPath.has(actualPath)) {
      problems.push(`unexpected file: ${actualPath}`);
    }
  }

  for (const [filePath, expected] of expectedByPath) {
    const actual = actualByPath.get(filePath);
    if (!actual) {
      continue;
    }
    if (actual.bytes !== expected.bytes) {
      problems.push(
        `byte count mismatch: ${filePath} expected=${String(expected.bytes)} actual=${String(actual.bytes)}`
      );
    }
    if (actual.sha256 !== expected.sha256) {
      problems.push(
        `SHA-256 mismatch: ${filePath} expected=${expected.sha256} actual=${actual.sha256}`
      );
    }
  }

  const canonicalLines = [...actualByPath]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([filePath, actual]) => `${actual.sha256}  ${filePath}\n`)
    .join("");
  const compositeSha256 = sha256(Buffer.from(canonicalLines, "utf8"));
  if (compositeSha256 !== manifest.composite.sha256) {
    problems.push(
      `composite SHA-256 mismatch: expected=${manifest.composite.sha256} actual=${compositeSha256}`
    );
  }

  if (problems.length > 0) {
    throw new LegacyRuntimeSealError(problems);
  }

  const implementationFiles = manifest.files.filter((file) => file.path.endsWith(".js"));
  const licenseFiles = manifest.files.filter((file) => !file.path.endsWith(".js"));
  return Object.freeze({
    manifestPath: normalizePath(path.relative(repositoryRoot, manifestPath)),
    runtimeRoot: normalizePath(path.relative(repositoryRoot, runtimeRoot)),
    files: manifest.files.length,
    bytes: manifest.files.reduce((total, file) => total + file.bytes, 0),
    implementationFiles: implementationFiles.length,
    implementationBytes: implementationFiles.reduce((total, file) => total + file.bytes, 0),
    licenseFiles: licenseFiles.length,
    licenseBytes: licenseFiles.reduce((total, file) => total + file.bytes, 0),
    compositeSha256
  });
}

async function main() {
  const result = await verifyLegacyRuntimeSeal();
  console.log(
    `Legacy runtime seal verified: files=${String(result.files)} bytes=${String(result.bytes)} ` +
      `sha256=${result.compositeSha256}`
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
