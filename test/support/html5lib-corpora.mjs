import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const HTML5LIB_REPOSITORY = "https://github.com/html5lib/html5lib-tests.git";
const CORPUS_CONTRACTS = Object.freeze([
  Object.freeze({
    id: "tokenizer",
    root: "test/fixtures/upstream/html5lib-tokenizer",
    sourceRoot: "tokenizer",
    extension: ".test",
    fixtureFiles: 14,
    supportingFiles: Object.freeze(["LICENSE", "README.md"])
  }),
  Object.freeze({
    id: "encoding",
    root: "test/fixtures/upstream/html5lib-encoding",
    sourceRoot: "encoding",
    extension: ".dat",
    fixtureFiles: 3,
    supportingFiles: Object.freeze(["LICENSE"])
  })
]);

export class Html5libCorpusError extends Error {
  constructor(problems) {
    super(`html5lib corpus verification failed:\n- ${problems.join("\n- ")}`);
    this.name = "Html5libCorpusError";
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

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function loadCorpus(contract, repositoryRoot = process.cwd()) {
  const manifestPath = resolve(repositoryRoot, contract.root, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Html5libCorpusError([
      `cannot read ${contract.root}/manifest.json: ${error instanceof Error ? error.message : String(error)}`
    ]);
  }

  const problems = [];
  if (manifest?.schemaVersion !== 1) problems.push(`${contract.id}: schemaVersion must be 1`);
  if (manifest?.corpus !== contract.id) problems.push(`${contract.id}: corpus identifier is invalid`);
  if (manifest?.repository !== HTML5LIB_REPOSITORY) {
    problems.push(`${contract.id}: repository must be the official html5lib-tests Git repository`);
  }
  if (!/^[a-f0-9]{40}$/.test(manifest?.commit ?? "")) {
    problems.push(`${contract.id}: commit must be a full Git object ID`);
  }
  if (manifest?.sourceRoot !== contract.sourceRoot) {
    problems.push(`${contract.id}: sourceRoot is invalid`);
  }
  if (manifest?.license !== "MIT") problems.push(`${contract.id}: license must be MIT`);
  if (!Array.isArray(manifest?.files)) problems.push(`${contract.id}: files must be an array`);
  if (!/^[a-f0-9]{64}$/.test(manifest?.compositeSha256 ?? "")) {
    problems.push(`${contract.id}: composite SHA-256 is invalid`);
  }

  const expectedByPath = new Map();
  for (const file of manifest?.files ?? []) {
    const filePath = typeof file?.path === "string" ? file.path : "";
    const validFixture = file?.kind === "fixture" &&
      !filePath.includes("/") && filePath.endsWith(contract.extension);
    const validSupportingFile = contract.supportingFiles.includes(filePath) &&
      (file?.kind === "license" || file?.kind === "format");
    if (!validFixture && !validSupportingFile) {
      problems.push(`${contract.id}: invalid path or kind: ${filePath || "<empty>"}`);
      continue;
    }
    if (expectedByPath.has(filePath)) {
      problems.push(`${contract.id}: duplicate manifest path: ${filePath}`);
      continue;
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      problems.push(`${contract.id}: invalid byte count: ${filePath}`);
    }
    if (!/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) {
      problems.push(`${contract.id}: invalid SHA-256: ${filePath}`);
    }
    if (!/^[a-f0-9]{40}$/.test(file.gitBlob ?? "")) {
      problems.push(`${contract.id}: invalid Git blob ID: ${filePath}`);
    }
    const expectedUpstreamPath = file.kind === "license"
      ? "LICENSE"
      : `${contract.sourceRoot}/${filePath}`;
    if (file.upstreamPath !== expectedUpstreamPath) {
      problems.push(`${contract.id}: invalid upstream path: ${filePath}`);
    }
    expectedByPath.set(filePath, file);
  }

  for (const supportingFile of contract.supportingFiles) {
    if (!expectedByPath.has(supportingFile)) {
      problems.push(`${contract.id}: manifest is missing ${supportingFile}`);
    }
  }
  const fixtureFiles = [...expectedByPath.values()].filter((file) => file.kind === "fixture");
  const fixtureBytes = fixtureFiles.reduce((total, file) => total + file.bytes, 0);
  if (fixtureFiles.length !== contract.fixtureFiles ||
      fixtureFiles.length !== manifest?.statistics?.fixtureFiles) {
    problems.push(`${contract.id}: fixture file count does not match the reviewed inventory`);
  }
  if (fixtureBytes !== manifest?.statistics?.fixtureBytes) {
    problems.push(`${contract.id}: fixture byte count does not match the manifest inventory`);
  }
  if (problems.length > 0) throw new Html5libCorpusError(problems);

  return Object.freeze({
    contract,
    manifest,
    expectedByPath,
    fixtures: Object.freeze(
      fixtureFiles.map((file) => Object.freeze({
        path: `${contract.root}/${file.path}`,
        upstreamPath: file.upstreamPath
      }))
    )
  });
}

const loadedCorpora = Object.freeze(CORPUS_CONTRACTS.map((contract) => loadCorpus(contract)));
const tokenizerCorpus = loadedCorpora.find((corpus) => corpus.contract.id === "tokenizer");
const encodingCorpus = loadedCorpora.find((corpus) => corpus.contract.id === "encoding");

export const TOKENIZER_FIXTURES = tokenizerCorpus.fixtures;
export const ENCODING_FIXTURES = encodingCorpus.fixtures;

async function verifyLoadedCorpus(corpus, repositoryRoot) {
  const problems = [];
  const corpusRoot = resolve(repositoryRoot, corpus.contract.root);
  let entries;
  try {
    entries = await readdir(corpusRoot, { withFileTypes: true });
  } catch (error) {
    return [`${corpus.contract.id}: cannot inventory snapshot: ${error instanceof Error ? error.message : String(error)}`];
  }

  const actualByPath = new Map();
  for (const entry of entries) {
    if (entry.name === "manifest.json") continue;
    if (!entry.isFile()) {
      problems.push(`${corpus.contract.id}: ${entry.name} is not a regular file`);
      continue;
    }
    const bytes = await readFile(resolve(corpusRoot, entry.name));
    actualByPath.set(entry.name, {
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      gitBlob: gitBlobSha1(bytes)
    });
  }

  for (const expectedPath of corpus.expectedByPath.keys()) {
    if (!actualByPath.has(expectedPath)) problems.push(`${corpus.contract.id}: missing file: ${expectedPath}`);
  }
  for (const actualPath of actualByPath.keys()) {
    if (!corpus.expectedByPath.has(actualPath)) {
      problems.push(`${corpus.contract.id}: unexpected file: ${actualPath}`);
    }
  }
  for (const [filePath, expected] of corpus.expectedByPath) {
    const actual = actualByPath.get(filePath);
    if (actual === undefined) continue;
    if (actual.bytes !== expected.bytes) problems.push(`${corpus.contract.id}: byte count mismatch: ${filePath}`);
    if (actual.sha256 !== expected.sha256) problems.push(`${corpus.contract.id}: SHA-256 mismatch: ${filePath}`);
    if (actual.gitBlob !== expected.gitBlob) problems.push(`${corpus.contract.id}: Git blob mismatch: ${filePath}`);
  }

  const canonicalLines = [...actualByPath]
    .sort(([left], [right]) => comparePaths(left, right))
    .map(([filePath, actual]) => `${actual.sha256}  ${filePath}\n`)
    .join("");
  const compositeSha256 = sha256(Buffer.from(canonicalLines, "utf8"));
  if (compositeSha256 !== corpus.manifest.compositeSha256) {
    problems.push(`${corpus.contract.id}: composite SHA-256 mismatch`);
  }
  return problems;
}

/** Verifies the exact inventory and bytes of both checked-in html5lib test corpora. */
export async function verifyHtml5libCorpora(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const verifyingCorpora = CORPUS_CONTRACTS.map((contract) =>
    loadCorpus(contract, repositoryRoot)
  );
  const problems = (await Promise.all(
    verifyingCorpora.map((corpus) => verifyLoadedCorpus(corpus, repositoryRoot))
  )).flat();
  const commits = new Set(verifyingCorpora.map((corpus) => corpus.manifest.commit));
  if (commits.size !== 1) problems.push("tokenizer and encoding snapshots must use the same upstream commit");
  if (problems.length > 0) throw new Html5libCorpusError(problems);
  const verifiedTokenizer = verifyingCorpora.find((corpus) => corpus.contract.id === "tokenizer");
  const verifiedEncoding = verifyingCorpora.find((corpus) => corpus.contract.id === "encoding");
  return Object.freeze({
    commit: verifyingCorpora[0].manifest.commit,
    tokenizerFixtures: verifiedTokenizer.fixtures,
    encodingFixtures: verifiedEncoding.fixtures
  });
}
