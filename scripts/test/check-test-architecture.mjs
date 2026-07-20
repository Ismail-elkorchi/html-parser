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

const FORBIDDEN_ENGINE_SOURCE_PATTERNS = Object.freeze([
  /src\/internal\/vendor/,
  new RegExp(["parse", "5-runtime"].join("")),
  /(?:from|import)\s*["'](?:parse5|entities|htmlparser2|jsdom)(?:[/'"])/
]);

const REMOVED_PRODUCTION_PATHS = Object.freeze([
  "src/internal/vendor",
  `src/internal/${["parse", "5-runtime.ts"].join("")}`,
  "src/internal/tokenizer",
  "src/internal/tree",
  "src/internal/serializer",
  "src/integration"
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

for (const filePath of REMOVED_PRODUCTION_PATHS) {
  if (await exists(filePath)) {
    throw new Error(`test architecture: removed production path remains: ${filePath}`);
  }
}

for (const filePath of await listFiles("src")) {
  const source = await readFile(filePath, "utf8");
  for (const helperName of FORBIDDEN_PRODUCTION_HELPERS) {
    if (source.includes(helperName)) {
      throw new Error(`test architecture: test-only helper remains in ${filePath}`);
    }
  }
  for (const pattern of FORBIDDEN_ENGINE_SOURCE_PATTERNS) {
    if (pattern.test(source)) {
      throw new Error(`test architecture: prohibited implementation reference in ${filePath}`);
    }
  }
}

process.stdout.write(
  "test architecture: one root, production/test-support boundaries, and private engine boundary verified\n"
);
