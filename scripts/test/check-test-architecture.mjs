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

const FORBIDDEN_ENGINE_SOURCE_PATTERNS = Object.freeze([
  /src\/internal\/vendor/,
  /parse5-runtime/,
  /(?:from|import)\s*["'](?:parse5|entities|htmlparser2|jsdom)(?:[/'"])/
]);

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(directoryPath) {
  const files = [];
  for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
    const entryPath = `${directoryPath}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await listFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
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

for (const filePath of await listFiles("src/internal/html-engine")) {
  const source = await readFile(filePath, "utf8");
  for (const pattern of FORBIDDEN_ENGINE_SOURCE_PATTERNS) {
    if (pattern.test(source)) {
      throw new Error(`test architecture: prohibited implementation reference in ${filePath}`);
    }
  }
}

for (const filePath of await listFiles("src/integration")) {
  const source = await readFile(filePath, "utf8");
  for (const pattern of FORBIDDEN_ENGINE_SOURCE_PATTERNS) {
    if (pattern.test(source)) {
      throw new Error(`test architecture: prohibited implementation reference in ${filePath}`);
    }
  }
}

for (const filePath of await listFiles("src/public")) {
  const source = await readFile(filePath, "utf8");
  if (source.includes("../integration/")) {
    throw new Error(`test architecture: production selected staged integration in ${filePath}`);
  }
}

process.stdout.write(
  "test architecture: one root, production/test-support boundaries, and engine isolation verified\n"
);
