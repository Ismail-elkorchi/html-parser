import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

export const WPT_SERIALIZATION_CORPUS_ROOT = "test/fixtures/upstream/wpt-serialization";
export const WPT_SERIALIZATION_MANIFEST_PATH = `${WPT_SERIALIZATION_CORPUS_ROOT}/manifest.json`;

const EXPECTED_REPOSITORY = "https://github.com/web-platform-tests/wpt.git";
const EXPECTED_SOURCE_ROOT = "html/syntax/serializing-html-fragments";
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class WptSerializationCorpusError extends Error {
  constructor(problems) {
    super(`WPT serialization corpus verification failed:\n- ${problems.join("\n- ")}`);
    this.name = "WptSerializationCorpusError";
    this.problems = Object.freeze([...problems]);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobSha1(bytes) {
  return createHash("sha1")
    .update(`blob ${String(bytes.byteLength)}\0`)
    .update(bytes)
    .digest("hex");
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function collectEntries(root) {
  const entries = [];
  async function walk(directory, relativeDirectory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => comparePaths(left.name, right.name));
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
  await walk(root, "");
  return entries;
}

function validateManifestFile(file, manifest, problems) {
  const filePath = normalizePath(file?.path ?? "");
  const pathIsValid = file?.kind === "license"
    ? filePath === "LICENSE.md"
    : file?.kind === "dependency"
      ? filePath === "dependencies/html-common.js"
      : file?.kind === "fixture" && /^files\/[A-Za-z0-9_.-]+\.html$/.test(filePath);
  if (!pathIsValid) problems.push(`invalid snapshot path/kind: ${filePath || "<empty>"}`);
  if (!Number.isSafeInteger(file?.bytes) || file.bytes < 0) problems.push(`invalid byte count: ${filePath}`);
  if (!/^[a-f0-9]{64}$/.test(file?.sha256 ?? "")) problems.push(`invalid SHA-256: ${filePath}`);
  if (!/^[a-f0-9]{40}$/.test(file?.gitBlob ?? "")) problems.push(`invalid Git blob ID: ${filePath}`);
  const expectedUpstreamPath = file?.kind === "license"
    ? "LICENSE.md"
    : file?.kind === "dependency"
      ? "html/resources/common.js"
      : `${manifest.sourceRoot}/${path.basename(filePath)}`;
  if (file?.upstreamPath !== expectedUpstreamPath) problems.push(`invalid upstream path: ${filePath}`);
  if (file?.kind === "fixture") {
    const status = file?.applicability?.status;
    if (status !== "applicable" && status !== "partial" && status !== "inapplicable") {
      problems.push(`invalid applicability status: ${filePath}`);
    }
    if (status !== "applicable" && !(typeof file?.applicability?.reason === "string" && file.applicability.reason.length > 0)) {
      problems.push(`non-applicable file needs a reason: ${filePath}`);
    }
  }
  return filePath;
}

export async function verifyWptSerializationCorpus(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const corpusRoot = path.resolve(
    repositoryRoot,
    options.corpusRoot ?? WPT_SERIALIZATION_CORPUS_ROOT
  );
  const manifestPath = path.resolve(
    repositoryRoot,
    options.manifestPath ?? WPT_SERIALIZATION_MANIFEST_PATH
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const problems = [];
  if (manifest?.schemaVersion !== 1) problems.push("manifest schemaVersion must be 1");
  if (manifest?.repository !== EXPECTED_REPOSITORY) problems.push("manifest repository must be official WPT");
  if (!/^[a-f0-9]{40}$/.test(manifest?.commit ?? "")) problems.push("manifest commit must be a full Git object ID");
  if (manifest?.sourceRoot !== EXPECTED_SOURCE_ROOT) problems.push("manifest sourceRoot is invalid");
  if (manifest?.license !== "BSD-3-Clause") problems.push("manifest license must be BSD-3-Clause");
  if (!Array.isArray(manifest?.files) || manifest.files.length === 0) problems.push("manifest files must be non-empty");
  if (!/^[a-f0-9]{64}$/.test(manifest?.compositeSha256 ?? "")) problems.push("manifest composite SHA-256 is invalid");
  if (!/^[a-f0-9]{64}$/.test(manifest?.applicabilitySha256 ?? "")) problems.push("manifest applicability SHA-256 is invalid");

  const expectedByPath = new Map();
  for (const file of manifest.files ?? []) {
    const filePath = validateManifestFile(file, manifest, problems);
    if (expectedByPath.has(filePath)) problems.push(`duplicate manifest path: ${filePath}`);
    expectedByPath.set(filePath, file);
  }
  if (expectedByPath.get("LICENSE.md")?.kind !== "license") problems.push("manifest must include the WPT root license");
  if (expectedByPath.get("dependencies/html-common.js")?.kind !== "dependency") {
    problems.push("manifest must include the outerHTML element-list dependency");
  }

  let actualEntries;
  try {
    actualEntries = await collectEntries(corpusRoot);
  } catch (error) {
    throw new WptSerializationCorpusError([
      ...problems,
      `cannot inventory ${normalizePath(corpusRoot)}: ${error instanceof Error ? error.message : String(error)}`
    ]);
  }
  const actualByPath = new Map();
  for (const entry of actualEntries) {
    if (entry.relativePath === "manifest.json") continue;
    if (entry.kind !== "file") {
      problems.push(`${entry.relativePath} is ${entry.kind}; only regular files are allowed`);
      continue;
    }
    const bytes = await readFile(entry.absolutePath);
    try {
      textDecoder.decode(bytes);
    } catch {
      problems.push(`fixture is not valid UTF-8: ${entry.relativePath}`);
    }
    actualByPath.set(entry.relativePath, {
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      gitBlob: gitBlobSha1(bytes)
    });
  }

  for (const expectedPath of expectedByPath.keys()) {
    if (!actualByPath.has(expectedPath)) problems.push(`missing file: ${expectedPath}`);
  }
  for (const actualPath of actualByPath.keys()) {
    if (!expectedByPath.has(actualPath)) problems.push(`unexpected file: ${actualPath}`);
  }
  for (const [filePath, expected] of expectedByPath) {
    const actual = actualByPath.get(filePath);
    if (actual === undefined) continue;
    if (actual.bytes !== expected.bytes) problems.push(`byte count mismatch: ${filePath}`);
    if (actual.sha256 !== expected.sha256) problems.push(`SHA-256 mismatch: ${filePath}`);
    if (actual.gitBlob !== expected.gitBlob) problems.push(`Git blob mismatch: ${filePath}`);
  }

  const canonicalLines = [...actualByPath]
    .sort(([left], [right]) => comparePaths(left, right))
    .map(([filePath, actual]) => `${actual.sha256}  ${filePath}\n`)
    .join("");
  const compositeSha256 = sha256(Buffer.from(canonicalLines, "utf8"));
  if (compositeSha256 !== manifest.compositeSha256) problems.push("composite SHA-256 mismatch");

  const fixtures = (manifest.files ?? []).filter((file) => file.kind === "fixture");
  const applicabilitySha256 = sha256(Buffer.from(JSON.stringify(
    fixtures.map((file) => ({ path: file.path, applicability: file.applicability }))
  ), "utf8"));
  if (applicabilitySha256 !== manifest.applicabilitySha256) problems.push("applicability SHA-256 mismatch");
  const statusCount = (status) => fixtures.filter((file) => file.applicability?.status === status).length;
  if (fixtures.length !== manifest?.statistics?.fixtureFiles) problems.push("fixture count mismatch");
  if (fixtures.reduce((total, file) => total + file.bytes, 0) !== manifest?.statistics?.fixtureBytes) {
    problems.push("fixture byte count mismatch");
  }
  if (statusCount("applicable") !== manifest?.statistics?.applicableFiles) problems.push("applicable count mismatch");
  if (statusCount("partial") !== manifest?.statistics?.partialFiles) problems.push("partial count mismatch");
  if (statusCount("inapplicable") !== manifest?.statistics?.inapplicableFiles) problems.push("inapplicable count mismatch");
  if (problems.length > 0) throw new WptSerializationCorpusError(problems);

  return Object.freeze({ corpusRoot, manifest, compositeSha256, applicabilitySha256 });
}
