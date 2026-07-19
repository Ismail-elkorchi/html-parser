import { readFileSync } from "node:fs";

const FIXTURE_ROOT = "vendor/html5lib-tests/tokenizer";
const FIXTURE_FILES = Object.freeze([
  "entities.test",
  "namedEntities.test",
  "numericEntities.test"
]);

interface JsonRecord {
  readonly [key: string]: unknown;
}

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
  for (const fileName of FIXTURE_FILES) {
    const parsed: unknown = JSON.parse(
      readFileSync(`${FIXTURE_ROOT}/${fileName}`, "utf8")
    );
    if (!isRecord(parsed) || !Array.isArray(parsed["tests"])) {
      throw new Error(`character reference fixtures: ${fileName} has an invalid root`);
    }
    for (const [index, rawTest] of parsed["tests"].entries()) {
      if (!isRecord(rawTest)) throw new Error(`character reference fixtures: invalid ${fileName} test`);
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
        throw new Error(`character reference fixtures: ${fileName}#${String(index)} is not standalone`);
      }
      const rawErrors = rawTest["errors"] ?? [];
      if (!Array.isArray(rawErrors)) {
        throw new Error(`character reference fixtures: ${fileName}#${String(index)} errors invalid`);
      }
      const errors = rawErrors.map((rawError) => {
        if (!isRecord(rawError) || typeof rawError["code"] !== "string") {
          throw new Error(`character reference fixtures: ${fileName}#${String(index)} error invalid`);
        }
        return rawError["code"];
      });
      fixtures.push(Object.freeze({
        id: `${fileName}#${String(index)}`,
        input,
        expected: output[0][1],
        errors: Object.freeze(errors)
      }));
    }
  }
  return Object.freeze(fixtures);
}
