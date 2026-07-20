import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import path, { dirname } from "node:path";

import {
  ENTITIES_PATH,
  GENERATED_PATH,
  LICENSE_PATH,
  MANIFEST_PATH,
  SNAPSHOT_DIRECTORY,
  canonicalJson,
  assertSameNamedReferences,
  inspectEntities,
  inspectStandardNamedReferenceTable,
  namedReferenceCompositeSha256,
  renderGeneratedTable,
  sha256
} from "./named-character-reference-data.mjs";
import { parseLongOptions } from "../lib/cli.mjs";
import { replacePathsAtomically } from "../lib/upstream-snapshot.mjs";

const ENTITIES_URL = "https://html.spec.whatwg.org/entities.json";

function validateSha256(name, value) {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`refresh named character references: --${name} must be lowercase SHA-256`);
  }
}

function validateByteCount(name, value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new Error(`refresh named character references: --${name} must be a positive safe integer`);
  }
  return parsed;
}

async function readLocalCandidate(filePath, expectedBytes) {
  const file = await open(filePath, "r");
  try {
    const fileStats = await file.stat();
    if (!fileStats.isFile() || fileStats.size !== expectedBytes) {
      throw new Error(
        `refresh named character references: ${filePath} must be a ${String(expectedBytes)}-byte file`
      );
    }
    const bytes = await file.readFile();
    if (bytes.length !== expectedBytes) {
      throw new Error(
        `refresh named character references: ${filePath} changed while being read`
      );
    }
    return bytes;
  } finally {
    await file.close();
  }
}

async function fetchBytes(url, expectedBytes) {
  const response = await globalThis.fetch(url, { redirect: "error" });
  if (!response.ok) {
    throw new Error(`refresh named character references: ${url} returned HTTP ${String(response.status)}`);
  }
  if (response.body === null) {
    throw new Error(`refresh named character references: ${url} returned no body`);
  }
  const chunks = [];
  const reader = response.body.getReader();
  let receivedBytes = 0;
  for (;;) {
    const read = await reader.read();
    if (read.done) break;
    receivedBytes += read.value.length;
    if (receivedBytes > expectedBytes) {
      await reader.cancel("verified byte limit exceeded");
      throw new Error(
        `refresh named character references: ${url} exceeded ${String(expectedBytes)} bytes`
      );
    }
    chunks.push(Buffer.from(read.value));
  }
  if (receivedBytes !== expectedBytes) {
    throw new Error(
      `refresh named character references: ${url} expected ${String(expectedBytes)} bytes, received ${String(receivedBytes)}`
    );
  }
  return Buffer.concat(chunks, receivedBytes);
}

const requiredString = Object.freeze({ type: "string", required: true });
const values = parseLongOptions(process.argv.slice(2), {
  "entities-file": requiredString,
  "entities-bytes": requiredString,
  "entities-sha256": requiredString,
  "license-file": requiredString,
  "license-bytes": requiredString,
  "license-revision": requiredString,
  "license-sha256": requiredString,
  "retrieved-at": requiredString,
  "standard-file": requiredString,
  "standard-bytes": requiredString,
  "standard-revision": requiredString,
  "standard-sha256": requiredString
}, "refresh named character references");
const entitiesFile = values["entities-file"];
const entitiesBytesExpected = validateByteCount(
  "entities-bytes",
  values["entities-bytes"]
);
const entitiesSha256 = values["entities-sha256"];
const licenseFile = values["license-file"];
const licenseBytesExpected = validateByteCount(
  "license-bytes",
  values["license-bytes"]
);
const licenseRevision = values["license-revision"];
const licenseSha256 = values["license-sha256"];
const retrievedAt = values["retrieved-at"];
const standardFile = values["standard-file"];
const standardBytesExpected = validateByteCount(
  "standard-bytes",
  values["standard-bytes"]
);
const standardRevision = values["standard-revision"];
const standardSha256 = values["standard-sha256"];
validateSha256("entities-sha256", entitiesSha256);
validateSha256("license-sha256", licenseSha256);
validateSha256("standard-sha256", standardSha256);
const parsedRetrievalDate = new Date(`${retrievedAt}T00:00:00.000Z`);
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt) ||
  Number.isNaN(parsedRetrievalDate.valueOf()) ||
  parsedRetrievalDate.toISOString().slice(0, 10) !== retrievedAt
) {
  throw new Error("refresh named character references: --retrieved-at must be YYYY-MM-DD");
}
if (!/^[0-9a-f]{40}$/.test(standardRevision)) {
  throw new Error("refresh named character references: --standard-revision must be 40 lowercase hex digits");
}
if (!/^[0-9a-f]{40}$/.test(licenseRevision)) {
  throw new Error("refresh named character references: --license-revision must be 40 lowercase hex digits");
}

const standardUrl = `https://html.spec.whatwg.org/commit-snapshots/${standardRevision}/`;
const licenseUrl = `https://raw.githubusercontent.com/whatwg/html/${licenseRevision}/LICENSE`;
const [
  entitiesBytes,
  licenseBytes,
  standardBytes,
  remoteEntitiesBytes,
  remoteLicenseBytes,
  remoteStandardBytes
] = await Promise.all([
  readLocalCandidate(entitiesFile, entitiesBytesExpected),
  readLocalCandidate(licenseFile, licenseBytesExpected),
  readLocalCandidate(standardFile, standardBytesExpected),
  fetchBytes(ENTITIES_URL, entitiesBytesExpected),
  fetchBytes(licenseUrl, licenseBytesExpected),
  fetchBytes(standardUrl, standardBytesExpected)
]);
const actualEntitiesSha256 = sha256(entitiesBytes);
const actualLicenseSha256 = sha256(licenseBytes);
const actualStandardSha256 = sha256(standardBytes);
if (actualEntitiesSha256 !== entitiesSha256) {
  throw new Error(
    `refresh named character references: entities SHA-256 expected=${entitiesSha256} actual=${actualEntitiesSha256}`
  );
}
if (actualLicenseSha256 !== licenseSha256) {
  throw new Error(
    `refresh named character references: license SHA-256 expected=${licenseSha256} actual=${actualLicenseSha256}`
  );
}
if (actualStandardSha256 !== standardSha256) {
  throw new Error(
    `refresh named character references: standard SHA-256 expected=${standardSha256} actual=${actualStandardSha256}`
  );
}
const remoteEntitiesSha256 = sha256(remoteEntitiesBytes);
const remoteLicenseSha256 = sha256(remoteLicenseBytes);
const remoteStandardSha256 = sha256(remoteStandardBytes);
if (remoteEntitiesSha256 !== entitiesSha256) {
  throw new Error(
    `refresh named character references: remote entities SHA-256 expected=${entitiesSha256} actual=${remoteEntitiesSha256}`
  );
}
if (remoteLicenseSha256 !== licenseSha256) {
  throw new Error(
    `refresh named character references: remote license SHA-256 expected=${licenseSha256} actual=${remoteLicenseSha256}`
  );
}
if (remoteStandardSha256 !== standardSha256) {
  throw new Error(
    `refresh named character references: remote standard SHA-256 expected=${standardSha256} actual=${remoteStandardSha256}`
  );
}

const inspection = inspectEntities(entitiesBytes);
const standardTable = inspectStandardNamedReferenceTable(standardBytes);
assertSameNamedReferences(inspection, standardTable);
const namedReferenceTableSha256 = namedReferenceCompositeSha256(inspection);
const manifest = {
  schemaVersion: 1,
  artifact: "WHATWG named character references",
  retrievedAt,
  entities: {
    url: ENTITIES_URL,
    bytes: entitiesBytes.length,
    sha256: actualEntitiesSha256,
    entryCount: inspection.entryCount,
    semicolonlessEntryCount: inspection.semicolonlessEntryCount,
    twoCodePointValueCount: inspection.twoCodePointValueCount,
    maximumNameLength: inspection.maximumNameLength,
    firstKey: inspection.firstKey,
    lastKey: inspection.lastKey
  },
  standard: {
    identity: "rendered WHATWG HTML commit snapshot; not a whatwg/html Git commit",
    revision: standardRevision,
    url: standardUrl,
    bytes: standardBytes.length,
    sha256: actualStandardSha256,
    namedReferenceTableEntryCount: standardTable.entryCount,
    namedReferenceTableSha256
  },
  license: {
    url: licenseUrl,
    bytes: licenseBytes.length,
    sha256: actualLicenseSha256
  },
  generation: {
    script: "scripts/generate/generate-named-character-references.mjs",
    output: GENERATED_PATH,
    ordering: "UTF-16 code-unit ascending by name after leading ampersand removal"
  }
};

await mkdir("tmp", { recursive: true });
const stagingRoot = await mkdtemp(path.join("tmp", "character-reference-refresh-"));
try {
  const snapshotStaging = path.join(stagingRoot, "snapshot");
  const generatedStaging = path.join(stagingRoot, "named-character-references.ts");
  await mkdir(snapshotStaging, { recursive: true });
  await mkdir(dirname(GENERATED_PATH), { recursive: true });
  await writeFile(path.join(snapshotStaging, path.basename(ENTITIES_PATH)), entitiesBytes);
  await writeFile(path.join(snapshotStaging, path.basename(LICENSE_PATH)), licenseBytes);
  await writeFile(
    path.join(snapshotStaging, path.basename(MANIFEST_PATH)),
    canonicalJson(manifest),
    "utf8"
  );
  await writeFile(
    generatedStaging,
    renderGeneratedTable(inspection, actualEntitiesSha256),
    "utf8"
  );
  await replacePathsAtomically([
    { source: snapshotStaging, destination: SNAPSHOT_DIRECTORY },
    { source: generatedStaging, destination: GENERATED_PATH }
  ]);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
process.stdout.write(
  `named character references: refreshed ${String(inspection.entryCount)} entries with verified provenance\n`
);
