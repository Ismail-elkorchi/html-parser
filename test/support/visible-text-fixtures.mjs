import { readFile } from "node:fs/promises";
import path from "node:path";

export const VISIBLE_TEXT_FIXTURES_PATH = "test/fixtures/visible-text.json";

export class VisibleTextFixtureError extends Error {
  constructor(problem) {
    super(`visible text fixtures: ${problem}`);
    this.name = "VisibleTextFixtureError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record, key, id) {
  const value = record[key];
  if (typeof value !== "string") {
    throw new VisibleTextFixtureError(`${id}.${key} must be a string`);
  }
  return value;
}

function requireTokens(record, key, id) {
  const value = record[key];
  if (!Array.isArray(value) || value.some((token) =>
    !isRecord(token) ||
    JSON.stringify(Object.keys(token).sort()) !== JSON.stringify(["kind", "value"]) ||
    !["text", "lineBreak", "paragraphBreak", "tab"].includes(token.kind) ||
    typeof token.value !== "string"
  )) {
    throw new VisibleTextFixtureError(`${id}.${key} must contain text-extraction tokens`);
  }
  return Object.freeze(value.map(({ kind, value }) => Object.freeze({ kind, value })));
}

function validateCases(rawCases, collectionName, fields) {
  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    throw new VisibleTextFixtureError(`${collectionName} must be a non-empty array`);
  }
  const ids = new Set();
  return Object.freeze(rawCases.map((rawCase, index) => {
    const location = `${collectionName}[${String(index)}]`;
    if (!isRecord(rawCase)) {
      throw new VisibleTextFixtureError(`${location} must be an object`);
    }
    const expectedKeys = ["id", ...fields].sort();
    if (JSON.stringify(Object.keys(rawCase).sort()) !== JSON.stringify(expectedKeys)) {
      throw new VisibleTextFixtureError(
        `${location} must contain only ${expectedKeys.join(", ")}`
      );
    }
    const id = requireString(rawCase, "id", location);
    if (!/^case-[0-9]{3}$/u.test(id)) {
      throw new VisibleTextFixtureError(`${location}.id has an invalid format`);
    }
    if (ids.has(id)) {
      throw new VisibleTextFixtureError(`${collectionName} contains duplicate id ${id}`);
    }
    ids.add(id);

    const fixture = { id };
    for (const field of fields) {
      fixture[field] = field.endsWith("Tokens")
        ? requireTokens(rawCase, field, id)
        : requireString(rawCase, field, id);
    }
    return Object.freeze(fixture);
  }));
}

/** Loads and validates the complete owned visible-text fixture corpus. */
export async function loadVisibleTextFixtures(options = {}) {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  let source;
  try {
    source = await readFile(path.resolve(repositoryRoot, VISIBLE_TEXT_FIXTURES_PATH), "utf8");
  } catch (error) {
    throw new VisibleTextFixtureError(
      `cannot read ${VISIBLE_TEXT_FIXTURES_PATH}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new VisibleTextFixtureError(
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!isRecord(parsed)) {
    throw new VisibleTextFixtureError("root must be an object");
  }
  const keys = Object.keys(parsed).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["accessibleNameFallback", "visibleText"])) {
    throw new VisibleTextFixtureError("root must contain only visibleText and accessibleNameFallback");
  }

  return Object.freeze({
    visibleText: validateCases(parsed.visibleText, "visibleText", [
      "input",
      "expectedText",
      "expectedTokens"
    ]),
    accessibleNameFallback: validateCases(
      parsed.accessibleNameFallback,
      "accessibleNameFallback",
      ["input", "expectedDefaultText", "expectedFallbackText", "expectedFallbackTokens"]
    )
  });
}
