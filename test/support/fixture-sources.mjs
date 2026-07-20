import { stat } from "node:fs/promises";

export const TOKENIZER_FIXTURE_FILES = Object.freeze([
  "vendor/html5lib-tests/tokenizer/test1.test",
  "vendor/html5lib-tests/tokenizer/test2.test",
  "vendor/html5lib-tests/tokenizer/test3.test",
  "vendor/html5lib-tests/tokenizer/test4.test",
  "vendor/html5lib-tests/tokenizer/entities.test",
  "vendor/html5lib-tests/tokenizer/namedEntities.test",
  "vendor/html5lib-tests/tokenizer/numericEntities.test",
  "vendor/html5lib-tests/tokenizer/unicodeChars.test",
  "vendor/html5lib-tests/tokenizer/unicodeCharsProblematic.test",
  "vendor/html5lib-tests/tokenizer/domjs.test",
  "vendor/html5lib-tests/tokenizer/escapeFlag.test",
  "vendor/html5lib-tests/tokenizer/contentModelFlags.test",
  "vendor/html5lib-tests/tokenizer/xmlViolation.test"
]);

export const TREE_FIXTURE_FILES = Object.freeze([
  "vendor/html5lib-tests/tree-construction/tests1.dat",
  "vendor/html5lib-tests/tree-construction/tests2.dat",
  "vendor/html5lib-tests/tree-construction/tests3.dat",
  "vendor/html5lib-tests/tree-construction/tests4.dat",
  "vendor/html5lib-tests/tree-construction/tests5.dat",
  "vendor/html5lib-tests/tree-construction/tests6.dat"
]);

export const ENCODING_FIXTURE_FILES = Object.freeze([
  "vendor/html5lib-tests/encoding/tests1.dat",
  "vendor/html5lib-tests/encoding/tests2.dat",
  "vendor/html5lib-tests/encoding/test-yahoo-jp.dat"
]);

export const ALL_HTML5LIB_FIXTURE_FILES = Object.freeze([
  ...TOKENIZER_FIXTURE_FILES,
  ...TREE_FIXTURE_FILES,
  ...ENCODING_FIXTURE_FILES
]);

/** Rejects absent or non-file fixture inputs with one actionable setup error. */
export async function requireFixtureFiles(filePaths) {
  const missing = [];
  for (const filePath of filePaths) {
    try {
      const entry = await stat(filePath);
      if (!entry.isFile()) missing.push(filePath);
    } catch {
      missing.push(filePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Required html5lib conformance data is unavailable:\n- ${missing.join("\n- ")}\n` +
        "Run: git submodule update --init --recursive"
    );
  }
}
