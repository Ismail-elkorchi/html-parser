import { readFile, readdir, stat } from "node:fs/promises";

const EXPECTED_TEST_DIRECTORIES = Object.freeze([
  "behavior",
  "conformance",
  "contracts",
  "engine",
  "fixtures",
  "support"
]);

const FORBIDDEN_PRODUCTION_HELPERS = Object.freeze([
  "buildTreeFromTokens",
  "doubleEscaped",
  "serializeFixtureTokenStream",
  "xmlViolationMode"
]);

const OWNED_BOUNDARY_FILES = Object.freeze([
  "src/internal/serializer/mod.ts",
  "src/internal/serializer/serialize.ts",
  "src/internal/tokenizer/tokenize.ts",
  "src/internal/tokenizer/tokens.ts",
  "src/internal/tree/build.ts",
  "src/internal/tree/mod.ts"
]);

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

if (await exists("tests")) {
  throw new Error("test architecture: obsolete tests root still exists");
}

const actualDirectories = (await readdir("test", { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (JSON.stringify(actualDirectories) !== JSON.stringify(EXPECTED_TEST_DIRECTORIES)) {
  throw new Error(
    `test architecture: expected ${EXPECTED_TEST_DIRECTORIES.join(", ")}; ` +
      `found ${actualDirectories.join(", ")}`
  );
}

for (const filePath of OWNED_BOUNDARY_FILES) {
  const source = await readFile(filePath, "utf8");
  for (const helperName of FORBIDDEN_PRODUCTION_HELPERS) {
    if (source.includes(helperName)) {
      throw new Error(`test architecture: ${helperName} remains in ${filePath}`);
    }
  }
}

process.stdout.write("test architecture: one root and production/test-support boundaries verified\n");
