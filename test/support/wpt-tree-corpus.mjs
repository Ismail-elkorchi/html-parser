import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

export const WPT_TREE_CORPUS_ROOT = "test/fixtures/upstream/wpt-tree-construction";
export const WPT_TREE_MANIFEST_PATH = `${WPT_TREE_CORPUS_ROOT}/manifest.json`;

const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class WptTreeCorpusError extends Error {
  constructor(problems) {
    super(`WPT tree corpus verification failed:\n- ${problems.join("\n- ")}`);
    this.name = "WptTreeCorpusError";
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

function validSnapshotPath(filePath, kind) {
  if (kind === "license") {
    return filePath === "LICENSE.md";
  }
  if (kind === "format") {
    return filePath === "resources/README.md";
  }
  return kind === "fixture" && /^resources\/[A-Za-z0-9_.-]+\.dat$/.test(filePath);
}

export async function verifyWptTreeCorpus(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const corpusRoot = path.resolve(repositoryRoot, options.corpusRoot ?? WPT_TREE_CORPUS_ROOT);
  const manifestPath = path.resolve(repositoryRoot, options.manifestPath ?? WPT_TREE_MANIFEST_PATH);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const problems = [];

  if (manifest?.schemaVersion !== 1) {
    problems.push("manifest schemaVersion must be 1");
  }
  if (manifest?.repository !== "https://github.com/web-platform-tests/wpt.git") {
    problems.push("manifest repository must be the official WPT Git repository");
  }
  if (!/^[a-f0-9]{40}$/.test(manifest?.commit ?? "")) {
    problems.push("manifest commit must be a full Git object ID");
  }
  if (manifest?.sourceRoot !== "html/syntax/parsing/resources") {
    problems.push("manifest sourceRoot is invalid");
  }
  if (manifest?.license !== "BSD-3-Clause") {
    problems.push("manifest license must be BSD-3-Clause");
  }
  if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
    problems.push("manifest files must be a non-empty array");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest?.compositeSha256 ?? "")) {
    problems.push("manifest composite SHA-256 is invalid");
  }

  const expectedByPath = new Map();
  for (const file of manifest.files ?? []) {
    const filePath = normalizePath(file?.path ?? "");
    if (!validSnapshotPath(filePath, file?.kind)) {
      problems.push(`invalid snapshot path/kind: ${filePath || "<empty>"}`);
      continue;
    }
    if (expectedByPath.has(filePath)) {
      problems.push(`duplicate manifest path: ${filePath}`);
      continue;
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      problems.push(`invalid byte count: ${filePath}`);
    }
    if (!/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) {
      problems.push(`invalid SHA-256: ${filePath}`);
    }
    if (!/^[a-f0-9]{40}$/.test(file.gitBlob ?? "")) {
      problems.push(`invalid Git blob ID: ${filePath}`);
    }
    const expectedUpstreamPath = file.kind === "license"
      ? "LICENSE.md"
      : file.kind === "format"
        ? `${manifest.sourceRoot}/README.md`
        : `${manifest.sourceRoot}/${path.basename(filePath)}`;
    if (file.upstreamPath !== expectedUpstreamPath) {
      problems.push(`invalid upstream path: ${filePath}`);
    }
    expectedByPath.set(filePath, file);
  }
  if (expectedByPath.get("LICENSE.md")?.kind !== "license") {
    problems.push("manifest must include the WPT root license");
  }
  if (expectedByPath.get("resources/README.md")?.kind !== "format") {
    problems.push("manifest must include the upstream fixture-format README");
  }

  let actualEntries;
  try {
    actualEntries = await collectEntries(corpusRoot);
  } catch (error) {
    throw new WptTreeCorpusError([
      ...problems,
      `cannot inventory ${normalizePath(corpusRoot)}: ${error instanceof Error ? error.message : String(error)}`
    ]);
  }

  const actualByPath = new Map();
  for (const entry of actualEntries) {
    if (entry.relativePath === "manifest.json") {
      continue;
    }
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
    if (actual === undefined) {
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
    if (actual.gitBlob !== expected.gitBlob) {
      problems.push(
        `Git blob mismatch: ${filePath} expected=${expected.gitBlob} actual=${actual.gitBlob}`
      );
    }
  }

  const canonicalLines = [...actualByPath]
    .sort(([left], [right]) => comparePaths(left, right))
    .map(([filePath, actual]) => `${actual.sha256}  ${filePath}\n`)
    .join("");
  const compositeSha256 = sha256(Buffer.from(canonicalLines, "utf8"));
  if (compositeSha256 !== manifest.compositeSha256) {
    problems.push(
      `composite SHA-256 mismatch: expected=${manifest.compositeSha256} actual=${compositeSha256}`
    );
  }

  const fixtureFiles = (manifest.files ?? [])
    .filter((file) => file.kind === "fixture")
    .map((file) => file.path);
  const fixtureBytes = (manifest.files ?? [])
    .filter((file) => file.kind === "fixture")
    .reduce((total, file) => total + file.bytes, 0);
  if (fixtureFiles.length !== manifest?.statistics?.fixtureFiles) {
    problems.push("manifest fixture file count does not match its file inventory");
  }
  if (fixtureBytes !== manifest?.statistics?.fixtureBytes) {
    problems.push("manifest fixture byte count does not match its file inventory");
  }

  if (problems.length > 0) {
    throw new WptTreeCorpusError(problems);
  }

  return Object.freeze({
    repositoryRoot,
    corpusRoot,
    manifest,
    fixtureFiles: Object.freeze(fixtureFiles),
    compositeSha256
  });
}
