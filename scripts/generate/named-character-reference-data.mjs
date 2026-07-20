import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { TextDecoder } from "node:util";

export const SNAPSHOT_DIRECTORY = "test/fixtures/upstream/whatwg-named-character-references";
export const ENTITIES_PATH = `${SNAPSHOT_DIRECTORY}/entities.json`;
export const LICENSE_PATH = `${SNAPSHOT_DIRECTORY}/LICENSE`;
export const MANIFEST_PATH = `${SNAPSHOT_DIRECTORY}/manifest.json`;
export const GENERATED_PATH =
  "src/internal/html-engine/generated/named-character-references.ts";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareCodeUnitStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function fail(message) {
  throw new Error(`named character reference data: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function inspectEntities(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    fail(`entities.json is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) fail("entities.json root must be an object");

  const sourceKeys = Object.keys(parsed);
  const sortedKeys = [...sourceKeys].sort(compareCodeUnitStrings);
  if (sourceKeys.some((key, index) => key !== sortedKeys[index])) {
    fail("entities.json keys must already be sorted by UTF-16 code units");
  }

  const entries = [];
  let semicolonlessEntryCount = 0;
  let twoCodePointValueCount = 0;
  let maximumNameLength = 0;

  for (const key of sourceKeys) {
    if (!/^&[0-9A-Za-z]+;?$/.test(key)) fail(`invalid reference key ${JSON.stringify(key)}`);
    const rawEntry = parsed[key];
    if (!isRecord(rawEntry)) fail(`entry ${key} must be an object`);
    const entryKeys = Object.keys(rawEntry).sort(compareCodeUnitStrings);
    if (JSON.stringify(entryKeys) !== JSON.stringify(["characters", "codepoints"])) {
      fail(`entry ${key} must contain only characters and codepoints`);
    }
    const codepoints = rawEntry.codepoints;
    const characters = rawEntry.characters;
    if (
      !Array.isArray(codepoints) ||
      codepoints.length < 1 ||
      codepoints.length > 2 ||
      codepoints.some(
        (codePoint) =>
          !Number.isSafeInteger(codePoint) ||
          codePoint < 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
      )
    ) {
      fail(`entry ${key} has invalid Unicode scalar values`);
    }
    if (typeof characters !== "string" || characters !== String.fromCodePoint(...codepoints)) {
      fail(`entry ${key} characters do not match codepoints`);
    }

    const name = key.slice(1);
    if (!name.endsWith(";")) semicolonlessEntryCount += 1;
    if (codepoints.length === 2) twoCodePointValueCount += 1;
    maximumNameLength = Math.max(maximumNameLength, name.length);
    entries.push(Object.freeze({ name, characters }));
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    entryCount: entries.length,
    semicolonlessEntryCount,
    twoCodePointValueCount,
    maximumNameLength,
    firstKey: sourceKeys[0] ?? null,
    lastKey: sourceKeys.at(-1) ?? null
  });
}

export function namedReferenceCompositeSha256(inspection) {
  const canonical = inspection.entries
    .map(({ name, characters }) => {
      const codePoints = [...characters].map((character) => character.codePointAt(0)?.toString(16));
      return `${name}\t${codePoints.join(",")}\n`;
    })
    .join("");
  return sha256(Buffer.from(canonical, "utf8"));
}

export function inspectStandardNamedReferenceTable(bytes) {
  let standard;
  try {
    standard = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail(`rendered standard is not valid UTF-8: ${error instanceof Error ? error.message : String(error)}`);
  }
  const tableMarker = /id=["]?named-character-references-table/.exec(standard);
  if (tableMarker === null) fail("rendered standard has no named-character-reference table");
  const tableEnd = standard.indexOf("</table>", tableMarker.index);
  if (tableEnd < 0) fail("rendered standard named-character-reference table is incomplete");
  const table = standard.slice(tableMarker.index, tableEnd);
  const rowPattern = /<tr[^>]*><td[^>]*>\s*<code[^>]*>([0-9A-Za-z]+;?)<\/code>\s*(?:<\/td>)?<td[^>]*>\s*((?:U\+[0-9A-F]+\s*){1,2})(?:<\/td>)?\s*<td/g;
  const rows = [];
  for (const match of table.matchAll(rowPattern)) {
    const name = match[1];
    const codePointText = match[2];
    if (name === undefined || codePointText === undefined) {
      fail("rendered standard named-character-reference row is incomplete");
    }
    const codePoints = [...codePointText.matchAll(/U\+([0-9A-F]+)/g)].map((codePointMatch) => {
      const hexadecimal = codePointMatch[1];
      if (hexadecimal === undefined) fail("rendered standard has an invalid code point");
      return Number.parseInt(hexadecimal, 16);
    });
    rows.push(Object.freeze({ name, characters: String.fromCodePoint(...codePoints) }));
  }
  rows.sort((left, right) => compareCodeUnitStrings(left.name, right.name));
  if (rows.length === 0) fail("rendered standard named-character-reference table has no rows");
  return Object.freeze({ entries: Object.freeze(rows), entryCount: rows.length });
}

export function assertSameNamedReferences(left, right) {
  assertEqual("standard table entry count", left.entryCount, right.entryCount);
  for (let index = 0; index < left.entries.length; index += 1) {
    const leftEntry = left.entries[index];
    const rightEntry = right.entries[index];
    if (
      leftEntry === undefined ||
      rightEntry === undefined ||
      leftEntry.name !== rightEntry.name ||
      leftEntry.characters !== rightEntry.characters
    ) {
      fail(`rendered standard and entities.json differ at sorted entry ${String(index)}`);
    }
  }
}

function encodeTypeScriptString(value) {
  let encoded = '"';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) fail("unexpected empty code point while generating table");
    if (codePoint >= 0x20 && codePoint <= 0x7e && character !== '"' && character !== "\\") {
      encoded += character;
    } else if (character === '"') {
      encoded += '\\"';
    } else if (character === "\\") {
      encoded += "\\\\";
    } else {
      encoded += `\\u{${codePoint.toString(16).toUpperCase()}}`;
    }
  }
  return `${encoded}"`;
}

export function renderGeneratedTable(inspection, entitiesSha256) {
  const lines = [
    "/* This file is generated by scripts/generate/generate-named-character-references.mjs. */",
    `/* WHATWG named-character data input SHA-256: ${entitiesSha256} */`,
    "",
    `export const NAMED_CHARACTER_REFERENCE_ENTRY_COUNT = ${String(inspection.entryCount)};`,
    `export const SEMICOLONLESS_NAMED_CHARACTER_REFERENCE_ENTRY_COUNT = ${String(inspection.semicolonlessEntryCount)};`,
    `export const MAX_NAMED_CHARACTER_REFERENCE_LENGTH = ${String(inspection.maximumNameLength)};`,
    "",
    "export const NAMED_CHARACTER_REFERENCE_DATA: readonly string[] = Object.freeze(["
  ];
  for (const entry of inspection.entries) {
    lines.push(
      `  ${encodeTypeScriptString(entry.name)}, ${encodeTypeScriptString(entry.characters)},`
    );
  }
  lines.push("]);", "");
  return lines.join("\n");
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    fail(`${label} mismatch: expected ${String(expected)}, found ${String(actual)}`);
  }
}

export async function readAndVerifySnapshot() {
  const [entitiesBytes, licenseBytes, manifestBytes] = await Promise.all([
    readFile(ENTITIES_PATH),
    readFile(LICENSE_PATH),
    readFile(MANIFEST_PATH)
  ]);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    fail(`manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(manifest) || manifest.schemaVersion !== 1) {
    fail("manifest schemaVersion must be 1");
  }
  if (!isRecord(manifest.entities) || !isRecord(manifest.license) || !isRecord(manifest.standard)) {
    fail("manifest must contain entities, license, and standard records");
  }

  const inspection = inspectEntities(entitiesBytes);
  assertEqual("entities bytes", entitiesBytes.length, manifest.entities.bytes);
  assertEqual("entities SHA-256", sha256(entitiesBytes), manifest.entities.sha256);
  assertEqual("entity count", inspection.entryCount, manifest.entities.entryCount);
  assertEqual(
    "semicolonless entity count",
    inspection.semicolonlessEntryCount,
    manifest.entities.semicolonlessEntryCount
  );
  assertEqual(
    "two-code-point entity count",
    inspection.twoCodePointValueCount,
    manifest.entities.twoCodePointValueCount
  );
  assertEqual("maximum name length", inspection.maximumNameLength, manifest.entities.maximumNameLength);
  assertEqual("first entity key", inspection.firstKey, manifest.entities.firstKey);
  assertEqual("last entity key", inspection.lastKey, manifest.entities.lastKey);
  assertEqual(
    "standard named-reference table entry count",
    inspection.entryCount,
    manifest.standard.namedReferenceTableEntryCount
  );
  assertEqual(
    "standard named-reference table composite SHA-256",
    namedReferenceCompositeSha256(inspection),
    manifest.standard.namedReferenceTableSha256
  );
  assertEqual("license bytes", licenseBytes.length, manifest.license.bytes);
  assertEqual("license SHA-256", sha256(licenseBytes), manifest.license.sha256);

  return Object.freeze({ entitiesBytes, inspection, licenseBytes, manifest });
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
