import { readFileSync } from "node:fs";

import { loadHtml5libTokenizerInventory } from "./html5lib-fixture-inventory.js";

const CHARACTER_REFERENCE_SOURCES = new Set([
  "tokenizer/entities.test",
  "tokenizer/namedEntities.test",
  "tokenizer/numericEntities.test"
]);

type JsonRecord = Readonly<Record<string, unknown>>;

export interface CharacterReferenceFixture {
  readonly id: string;
  readonly input: string;
  readonly expected: string;
  readonly errors: readonly string[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Loads every standalone character-reference case from the pinned html5lib corpus. */
export function loadCharacterReferenceFixtures(): readonly CharacterReferenceFixture[] {
  const fixtures: CharacterReferenceFixture[] = [];
  const fixtureSources = loadHtml5libTokenizerInventory().filter((source) =>
    CHARACTER_REFERENCE_SOURCES.has(source.upstreamPath)
  );
  if (fixtureSources.length !== CHARACTER_REFERENCE_SOURCES.size) {
    throw new Error("character reference fixture inventory is incomplete");
  }
  for (const fixtureSource of fixtureSources) {
    const parsed: unknown = JSON.parse(readFileSync(fixtureSource.path, "utf8"));
    if (!isRecord(parsed) || !Array.isArray(parsed["tests"])) {
      throw new Error(`character reference fixtures: ${fixtureSource.upstreamPath} has an invalid root`);
    }
    for (const [index, rawTest] of parsed["tests"].entries()) {
      if (!isRecord(rawTest)) {
        throw new Error(`character reference fixtures: invalid ${fixtureSource.upstreamPath} test`);
      }
      const input = rawTest["input"];
      if (typeof input !== "string" || !input.startsWith("&")) continue;
      const output = rawTest["output"];
      if (
        !Array.isArray(output) ||
        output.length !== 1 ||
        !Array.isArray(output[0]) ||
        output[0][0] !== "Character" ||
        typeof output[0][1] !== "string"
      ) {
        throw new Error(
          `character reference fixtures: ${fixtureSource.upstreamPath}#${String(index)} is not standalone`
        );
      }
      const rawErrors = rawTest["errors"] ?? [];
      if (!Array.isArray(rawErrors)) {
        throw new Error(
          `character reference fixtures: ${fixtureSource.upstreamPath}#${String(index)} errors invalid`
        );
      }
      const errors = rawErrors.map((rawError) => {
        if (!isRecord(rawError) || typeof rawError["code"] !== "string") {
          throw new Error(
            `character reference fixtures: ${fixtureSource.upstreamPath}#${String(index)} error invalid`
          );
        }
        return rawError["code"];
      });
      fixtures.push(Object.freeze({
        id: `${fixtureSource.upstreamPath}#${String(index)}`,
        input,
        expected: output[0][1],
        errors: Object.freeze(errors)
      }));
    }
  }
  return Object.freeze(fixtures);
}
