import { readFile } from "node:fs/promises";

import { sniffHtmlEncoding } from "../../dist/internal/encoding/sniff.js";
import { serializeFixtureTokenStream } from "../../dist/internal/serializer/mod.js";
import { tokenize } from "../../dist/internal/tokenizer/mod.js";
import { buildTreeFromHtml, normalizeTree } from "../../dist/internal/tree/mod.js";
import { writeJson } from "../eval/util.mjs";

const HOLDOUT_MOD = 10;
const HOLDOUT_RULE = `hash(id) % ${HOLDOUT_MOD} === 0`;

const TOKENIZER_FILES = [
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
];

const TREE_FILES = [
  "vendor/html5lib-tests/tree-construction/tests1.dat",
  "vendor/html5lib-tests/tree-construction/tests2.dat",
  "vendor/html5lib-tests/tree-construction/tests3.dat",
  "vendor/html5lib-tests/tree-construction/tests4.dat",
  "vendor/html5lib-tests/tree-construction/tests5.dat",
  "vendor/html5lib-tests/tree-construction/tests6.dat"
];

const ENCODING_FIXTURE_FILES = [
  "vendor/html5lib-tests/encoding/tests1.dat",
  "vendor/html5lib-tests/encoding/tests2.dat",
  "vendor/html5lib-tests/encoding/test-yahoo-jp.dat"
];

const SERIALIZER_FILES = [
  "vendor/html5lib-tests/serializer/core.test",
  "vendor/html5lib-tests/serializer/options.test",
  "vendor/html5lib-tests/serializer/whitespace.test",
  "vendor/html5lib-tests/serializer/optionaltags.test",
  "vendor/html5lib-tests/serializer/injectmeta.test"
];

const encoder = new TextEncoder();

function hashWithMultiplier(id, multiplier) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (Math.imul(hash, multiplier) + id.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function isTokenizerHoldout(id) {
  return hashWithMultiplier(id, 33) % HOLDOUT_MOD === 0;
}

function isTreeHoldout(id) {
  return hashWithMultiplier(id, 31) % HOLDOUT_MOD === 0;
}

function isEncodingHoldout(id) {
  return hashWithMultiplier(id, 29) % HOLDOUT_MOD === 0;
}

function isSerializerHoldout(id) {
  return hashWithMultiplier(id, 37) % HOLDOUT_MOD === 0;
}

function fixtureTokenToComparable(token) {
  return JSON.stringify(token);
}

function tokenizerTokenToFixture(token) {
  if (token.type === "StartTag") {
    return token.selfClosing
      ? ["StartTag", token.name, token.attributes, true]
      : ["StartTag", token.name, token.attributes];
  }

  if (token.type === "EndTag") {
    return ["EndTag", token.name];
  }

  if (token.type === "Comment") {
    return ["Comment", token.data];
  }

  if (token.type === "Doctype") {
    const name = token.name.length === 0 ? null : token.name;
    return ["DOCTYPE", name, token.publicId, token.systemId, !token.forceQuirks];
  }

  if (token.type === "Character") {
    return ["Character", token.data];
  }

  return null;
}

function normalizeTokenArray(tokens) {
  return tokens
    .map((token) => tokenizerTokenToFixture(token))
    .filter((token) => token !== null)
    .map((token) => fixtureTokenToComparable(token));
}

function parseTreeDatFixtureFile(content, fileName) {
  const lines = content.split(/\r?\n/);
  const tests = [];
  let section = "";
  let current = null;

  const pushCurrent = () => {
    if (current === null) {
      return;
    }

    if (current.data.length === 0 && current.documentLines.length === 0) {
      current = null;
      section = "";
      return;
    }

    tests.push({
      id: `${fileName}#${tests.length + 1}`,
      data: current.data,
      expected: current.documentLines.join("\n"),
      fragmentContextTagName: current.fragmentContextTagName,
      scriptingEnabled: current.scriptingEnabled
    });

    current = null;
    section = "";
  };

  for (const line of lines) {
    if (line === "#data") {
      pushCurrent();
      current = {
        data: "",
        documentLines: [],
        fragmentContextTagName: undefined,
        scriptingEnabled: true
      };
      section = "data";
      continue;
    }

    if (current === null) {
      continue;
    }

    if (line === "#errors" || line === "#new-errors") {
      section = "errors";
      continue;
    }

    if (line === "#document") {
      section = "document";
      continue;
    }

    if (line === "#document-fragment") {
      section = "fragment";
      continue;
    }

    if (line === "#script-on") {
      current.scriptingEnabled = true;
      section = "";
      continue;
    }

    if (line === "#script-off") {
      current.scriptingEnabled = false;
      section = "";
      continue;
    }

    if (line.startsWith("#")) {
      section = "";
      continue;
    }

    if (section === "data") {
      if (current.data.length > 0) {
        current.data += "\n";
      }
      current.data += line;
      continue;
    }

    if (section === "document") {
      current.documentLines.push(line);
      continue;
    }

    if (section === "fragment" && current.fragmentContextTagName === undefined) {
      current.fragmentContextTagName = line.trim().toLowerCase();
    }
  }

  pushCurrent();
  return tests;
}

function parseEncodingDatFixtures(text, fileName) {
  const lines = text.split(/\r?\n/);
  const cases = [];

  let section = "";
  let dataLines = [];
  let expected = "";

  function pushCurrent() {
    if (dataLines.length === 0 && expected.trim().length === 0) {
      return;
    }

    if (expected.trim().length === 0) {
      return;
    }

    cases.push({
      id: `${fileName}#${cases.length + 1}`,
      data: dataLines.join("\n"),
      expectedEncoding: expected.trim().toLowerCase()
    });

    dataLines = [];
    expected = "";
  }

  for (const line of lines) {
    if (line === "#data") {
      pushCurrent();
      section = "data";
      continue;
    }

    if (line === "#encoding") {
      section = "encoding";
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    if (section === "data") {
      dataLines.push(line);
      continue;
    }

    if (section === "encoding") {
      if (expected.length > 0) {
        expected += "\n";
      }
      expected += line;
    }
  }

  pushCurrent();
  return cases;
}

function normalizeFixtureOutput(value) {
  return value.trimEnd();
}

function sumCases(records) {
  const total = records.reduce((sum, record) => sum + record.cases.total, 0);
  const passed = records.reduce((sum, record) => sum + record.cases.passed, 0);
  const failed = records.reduce((sum, record) => sum + record.cases.failed, 0);
  const skipped = records.reduce((sum, record) => sum + record.cases.skipped, 0);
  return { total, passed, failed, skipped };
}

async function runTokenizerHoldout() {
  const parsedCases = [];
  for (const path of TOKENIZER_FILES) {
    const raw = JSON.parse(await readFile(path, "utf8"));
    const tests = raw.tests ?? raw.xmlViolationTests ?? [];

    for (let index = 0; index < tests.length; index += 1) {
      const fixture = tests[index];
      const fixtureId = `${path}#${index + 1}`;
      const initialStates = fixture.initialStates ?? ["Data state"];

      for (const initialState of initialStates) {
        parsedCases.push({
          id: `${fixtureId}@${initialState}`,
          fixtureId,
          file: path,
          input: fixture.input ?? "",
          output: fixture.output ?? [],
          initialState,
          lastStartTag: fixture.lastStartTag,
          doubleEscaped: fixture.doubleEscaped ?? false,
          xmlViolationMode: path.endsWith("xmlViolation.test")
        });
      }
    }
  }

  const selectedCases = parsedCases.filter((fixture) => isTokenizerHoldout(fixture.fixtureId));

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const fixture of selectedCases) {
    const result = tokenize(fixture.input, {
      initialState: fixture.initialState,
      lastStartTag: fixture.lastStartTag,
      doubleEscaped: fixture.doubleEscaped,
      xmlViolationMode: fixture.xmlViolationMode,
      budgets: {
        maxTextBytes: 200000,
        maxTokenBytes: 16000,
        maxParseErrors: 2000,
        maxTimeMs: 50
      }
    });

    const expected = fixture.output.map((token) => fixtureTokenToComparable(token));
    const actual = normalizeTokenArray(result.tokens);
    const isMatch = JSON.stringify(expected) === JSON.stringify(actual);

    if (isMatch) {
      passed += 1;
      continue;
    }

    failed += 1;
    failures.push({
      suite: "tokenizer",
      id: fixture.id,
      expectedPreview: expected.slice(0, 8),
      actualPreview: actual.slice(0, 8)
    });
  }

  return {
    cases: {
      total: selectedCases.length,
      passed,
      failed,
      skipped: 0
    },
    holdoutRule: HOLDOUT_RULE,
    holdoutMod: HOLDOUT_MOD,
    totalSurface: parsedCases.length,
    failures
  };
}

async function runTreeHoldout() {
  const allTests = [];
  for (const file of TREE_FILES) {
    const data = await readFile(file, "utf8");
    allTests.push(...parseTreeDatFixtureFile(data, file));
  }

  const selectedCases = allTests.filter((testCase) => isTreeHoldout(testCase.id));
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const testCase of selectedCases) {
    const built = buildTreeFromHtml(
      testCase.data,
      {
        maxNodes: 4000,
        maxDepth: 256,
        maxAttributesPerElement: 256,
        maxAttributeBytes: 65536
      },
      {
        fragmentContextTagName: testCase.fragmentContextTagName,
        scriptingEnabled: testCase.scriptingEnabled
      }
    );

    const actual = normalizeFixtureOutput(normalizeTree(built.document));
    const expected = normalizeFixtureOutput(testCase.expected);

    if (actual === expected) {
      passed += 1;
      continue;
    }

    failed += 1;
    failures.push({
      suite: "tree",
      id: testCase.id,
      fragmentContextTagName: testCase.fragmentContextTagName ?? null,
      scriptingEnabled: testCase.scriptingEnabled,
      treeErrors: built.errors.slice(0, 10)
    });
  }

  return {
    cases: {
      total: selectedCases.length,
      passed,
      failed,
      skipped: 0
    },
    holdoutRule: HOLDOUT_RULE,
    holdoutMod: HOLDOUT_MOD,
    totalSurface: allTests.length,
    failures
  };
}

async function runEncodingHoldout() {
  const allCases = [];
  for (const fixturePath of ENCODING_FIXTURE_FILES) {
    const content = await readFile(fixturePath, "utf8");
    allCases.push(...parseEncodingDatFixtures(content, fixturePath));
  }

  const selectedCases = allCases.filter((fixture) => isEncodingHoldout(fixture.id));
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const fixture of selectedCases) {
    const bytes = encoder.encode(fixture.data);
    const result = sniffHtmlEncoding(bytes, { defaultEncoding: "windows-1252" });

    if (fixture.expectedEncoding === result.encoding) {
      passed += 1;
      continue;
    }

    failed += 1;
    failures.push({
      suite: "encoding",
      id: fixture.id,
      expected: fixture.expectedEncoding,
      actual: result.encoding,
      source: result.source
    });
  }

  return {
    cases: {
      total: selectedCases.length,
      passed,
      failed,
      skipped: 0
    },
    holdoutRule: HOLDOUT_RULE,
    holdoutMod: HOLDOUT_MOD,
    totalSurface: allCases.length,
    failures
  };
}

async function runSerializerHoldout() {
  const tests = [];
  for (const file of SERIALIZER_FILES) {
    const raw = JSON.parse(await readFile(file, "utf8"));
    for (let index = 0; index < (raw.tests ?? []).length; index += 1) {
      const test = raw.tests[index];
      tests.push({
        id: `${file}#${index + 1}`,
        input: test.input ?? [],
        expected: Array.isArray(test.expected) ? String(test.expected[0] ?? "") : "",
        options: test.options ?? {}
      });
    }
  }

  const selectedCases = tests.filter((fixture) => isSerializerHoldout(fixture.id));
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const fixture of selectedCases) {
    const actual = serializeFixtureTokenStream(fixture.input, fixture.options);

    if (actual === fixture.expected) {
      passed += 1;
      continue;
    }

    failed += 1;
    failures.push({
      suite: "serializer",
      id: fixture.id,
      expected: fixture.expected,
      actual
    });
  }

  return {
    cases: {
      total: selectedCases.length,
      passed,
      failed,
      skipped: 0
    },
    holdoutRule: HOLDOUT_RULE,
    holdoutMod: HOLDOUT_MOD,
    totalSurface: tests.length,
    failures
  };
}

const tokenizer = await runTokenizerHoldout();
const tree = await runTreeHoldout();
const encoding = await runEncodingHoldout();
const serializer = await runSerializerHoldout();

const suites = {
  tokenizer,
  tree,
  encoding,
  serializer
};

const cases = sumCases([tokenizer, tree, encoding, serializer]);
const failures = [...tokenizer.failures, ...tree.failures, ...encoding.failures, ...serializer.failures];

await writeJson("reports/holdout.json", {
  suite: "holdout",
  timestamp: new Date().toISOString(),
  holdoutRule: HOLDOUT_RULE,
  holdoutMod: HOLDOUT_MOD,
  suites,
  cases,
  skips: [],
  failures
});

if (cases.failed > 0) {
  console.error(`Holdout hard failures: ${cases.failed}`);
  process.exit(1);
}

console.log(
  `Holdout fixtures: passed=${cases.passed}, failed=${cases.failed}, total=${cases.total} `
    + `(tokenizer=${tokenizer.cases.total}, tree=${tree.cases.total}, `
    + `encoding=${encoding.cases.total}, serializer=${serializer.cases.total})`
);
