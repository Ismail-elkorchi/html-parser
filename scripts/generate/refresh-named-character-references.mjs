import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

const DEFAULT_ENTITIES_URL = "https://html.spec.whatwg.org/entities.json";

function parseArguments(arguments_) {
  const values = new Map();
  for (const argument of arguments_) {
    const match = /^--([a-z0-9-]+)=(.+)$/.exec(argument);
    if (match === null) throw new Error(`refresh named character references: invalid argument ${argument}`);
    const [, name, value] = match;
    if (name === undefined || value === undefined || values.has(name)) {
      throw new Error(`refresh named character references: invalid or duplicate argument ${argument}`);
    }
    values.set(name, value);
  }
  const required = [
    "entities-sha256",
    "license-url",
    "license-sha256",
    "retrieved-at",
    "standard-revision",
    "standard-sha256"
  ];
  for (const name of required) {
    if (!values.has(name)) throw new Error(`refresh named character references: missing --${name}`);
  }
  const allowed = new Set([...required, "entities-url"]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new Error(`refresh named character references: unsupported --${name}`);
  }
  return values;
}

function requiredValue(values, name) {
  const value = values.get(name);
  if (value === undefined) throw new Error(`refresh named character references: missing --${name}`);
  return value;
}

function validateSha256(name, value) {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`refresh named character references: --${name} must be lowercase SHA-256`);
  }
}

async function fetchBytes(url) {
  const response = await globalThis.fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`refresh named character references: ${url} returned HTTP ${String(response.status)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

const values = parseArguments(process.argv.slice(2));
const entitiesUrl = values.get("entities-url") ?? DEFAULT_ENTITIES_URL;
const entitiesSha256 = requiredValue(values, "entities-sha256");
const licenseUrl = requiredValue(values, "license-url");
const licenseSha256 = requiredValue(values, "license-sha256");
const retrievedAt = requiredValue(values, "retrieved-at");
const standardRevision = requiredValue(values, "standard-revision");
const standardSha256 = requiredValue(values, "standard-sha256");
validateSha256("entities-sha256", entitiesSha256);
validateSha256("license-sha256", licenseSha256);
validateSha256("standard-sha256", standardSha256);
if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt)) {
  throw new Error("refresh named character references: --retrieved-at must be YYYY-MM-DD");
}
if (!/^[0-9a-f]{40}$/.test(standardRevision)) {
  throw new Error("refresh named character references: --standard-revision must be 40 lowercase hex digits");
}

const standardUrl = `https://html.spec.whatwg.org/commit-snapshots/${standardRevision}/`;
const [entitiesBytes, licenseBytes, standardBytes] = await Promise.all([
  fetchBytes(entitiesUrl),
  fetchBytes(licenseUrl),
  fetchBytes(standardUrl)
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

const inspection = inspectEntities(entitiesBytes);
const standardTable = inspectStandardNamedReferenceTable(standardBytes);
assertSameNamedReferences(inspection, standardTable);
const namedReferenceTableSha256 = namedReferenceCompositeSha256(inspection);
const manifest = {
  schemaVersion: 1,
  artifact: "WHATWG named character references",
  retrievedAt,
  entities: {
    url: entitiesUrl,
    bytes: entitiesBytes.length,
    sha256: actualEntitiesSha256,
    entryCount: inspection.entryCount,
    legacyEntryCount: inspection.legacyEntryCount,
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

await mkdir(SNAPSHOT_DIRECTORY, { recursive: true });
await mkdir(dirname(GENERATED_PATH), { recursive: true });
await writeFile(ENTITIES_PATH, entitiesBytes);
await writeFile(LICENSE_PATH, licenseBytes);
await writeFile(MANIFEST_PATH, canonicalJson(manifest), "utf8");
await writeFile(
  GENERATED_PATH,
  renderGeneratedTable(inspection, actualEntitiesSha256),
  "utf8"
);
process.stdout.write(
  `named character references: refreshed ${String(inspection.entryCount)} entries with verified provenance\n`
);
