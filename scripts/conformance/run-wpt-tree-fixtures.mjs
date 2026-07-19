import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { buildTreeFromHtml, normalizeTree } from "../../dist/internal/tree/mod.js";
import { TREE_FIXTURE_FILES } from "../../test/support/fixture-sources.mjs";
import { nowIso, writeJson } from "../eval/eval-primitives.mjs";
import {
  expandTreeDatCases,
  parseTreeDatFixtures,
  TREE_DAT_NAMESPACES
} from "../../test/support/tree-dat.mjs";
import { verifyWptTreeCorpus } from "../../test/support/wpt-tree-corpus.mjs";

const BASELINE_PATH = "test/fixtures/conformance/wpt-tree-legacy-result.json";
const HOLDOUT_MOD = 10;
const HOLDOUT_RULE = `hash(id) % ${HOLDOUT_MOD} === 0`;
const SCRIPT_EXECUTION_CASES = new Map([
  ["resources/scripted_adoption01.dat#1", "requires-live-dom-mutation"],
  ["resources/scripted_ark.dat#1", "requires-live-dom-mutation"],
  ["resources/scripted_webkit01.dat#1", "requires-document-write"],
  ["resources/scripted_webkit01.dat#2", "requires-document-write"]
]);
const TREE_BUDGETS = Object.freeze({
  maxNodes: 100000,
  maxDepth: 10000,
  maxParseErrors: 100000,
  maxAttributesPerElement: 10000,
  maxAttributeBytes: 10000000
});
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeFixtureOutput(value) {
  return value.trimEnd();
}

function isHoldout(fixtureId) {
  let hash = 0;
  for (let charIndex = 0; charIndex < fixtureId.length; charIndex += 1) {
    hash = (Math.imul(hash, 31) + fixtureId.charCodeAt(charIndex)) >>> 0;
  }
  return hash % HOLDOUT_MOD === 0;
}

function serializeThrown(error) {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: String(error), code: null };
  }
  return {
    name: error.name,
    message: error.message,
    code: typeof error.code === "string" ? error.code : null
  };
}

function classificationFor(fixtureCase) {
  const scriptReason = SCRIPT_EXECUTION_CASES.get(fixtureCase.baseId);
  if (scriptReason !== undefined) {
    return { status: "inapplicable", reason: scriptReason };
  }
  if (
    fixtureCase.fragmentContext !== null &&
    fixtureCase.fragmentContext.namespaceUri !== TREE_DAT_NAMESPACES.html
  ) {
    return {
      status: "unsupported",
      reason: "legacy-fragment-facade-cannot-express-svg-or-mathml-context"
    };
  }
  return { status: "executable", reason: null };
}

function outcomeDigest(records) {
  const stableRecords = records.map((record) => ({
    id: record.id,
    status: record.status,
    reason: record.reason,
    expectedTreeSha256: record.expectedTreeSha256,
    actualTreeSha256: record.actualTreeSha256,
    expectedParseErrors: record.expectedParseErrors,
    actualParseErrors: record.actualParseErrors,
    parseErrorCountMatches: record.parseErrorCountMatches,
    parseErrorsSha256: record.parseErrorsSha256,
    error: record.error
  }));
  return sha256(Buffer.from(JSON.stringify(stableRecords), "utf8"));
}

function summarize(records) {
  const counts = {
    total: records.length,
    applicable: 0,
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    unsupported: 0,
    inapplicable: 0
  };
  for (const record of records) {
    if (record.status !== "inapplicable") {
      counts.applicable += 1;
    }
    if (record.status === "pass" || record.status === "fail") {
      counts.executed += 1;
    }
    if (record.status === "pass") {
      counts.passed += 1;
    } else if (record.status === "fail") {
      counts.failed += 1;
    } else {
      counts.skipped += 1;
      if (record.status === "unsupported") {
        counts.unsupported += 1;
      } else {
        counts.inapplicable += 1;
      }
    }
  }
  return counts;
}

function summarizeParseErrors(records) {
  const counts = {
    declaredAndExecuted: 0,
    matched: 0,
    mismatched: 0,
    notDeclaredAndExecuted: 0,
    notExecuted: 0
  };
  for (const record of records) {
    if (record.actualParseErrors === null) {
      counts.notExecuted += 1;
    } else if (record.expectedParseErrors === null) {
      counts.notDeclaredAndExecuted += 1;
    } else {
      counts.declaredAndExecuted += 1;
      if (record.parseErrorCountMatches) {
        counts.matched += 1;
      } else {
        counts.mismatched += 1;
      }
    }
  }
  return counts;
}

async function loadWptCases(corpus) {
  const baseCases = [];
  for (const fixturePath of corpus.fixtureFiles) {
    const bytes = await readFile(path.join(corpus.corpusRoot, fixturePath));
    const content = textDecoder.decode(bytes);
    baseCases.push(...parseTreeDatFixtures(content, fixturePath));
  }

  const scriptedBaseIds = baseCases
    .filter((fixtureCase) => path.basename(fixtureCase.file).startsWith("scripted_"))
    .map((fixtureCase) => fixtureCase.id)
    .sort();
  const classifiedScriptIds = [...SCRIPT_EXECUTION_CASES.keys()].sort();
  if (JSON.stringify(scriptedBaseIds) !== JSON.stringify(classifiedScriptIds)) {
    throw new Error(
      "script-execution fixture inventory changed; review and update the explicit case classification"
    );
  }

  const executionCases = expandTreeDatCases(baseCases);
  if (baseCases.length !== corpus.manifest.statistics.baseCases) {
    throw new Error(
      `parsed base-case count ${String(baseCases.length)} does not match manifest ` +
        `${String(corpus.manifest.statistics.baseCases)}`
    );
  }
  if (executionCases.length !== corpus.manifest.statistics.executionVariants) {
    throw new Error(
      `parsed execution-variant count ${String(executionCases.length)} does not match manifest ` +
        `${String(corpus.manifest.statistics.executionVariants)}`
    );
  }
  return { baseCases, executionCases };
}

function runCases(executionCases) {
  const records = [];
  for (const fixtureCase of executionCases) {
    const classification = classificationFor(fixtureCase);
    const partition = isHoldout(fixtureCase.id) ? "current-holdout" : "current-primary";
    const expectedTree = normalizeFixtureOutput(fixtureCase.expected);
    const expectedTreeSha256 = sha256(Buffer.from(expectedTree, "utf8"));
    const expectedParseErrors = fixtureCase.errorsDeclared
      ? fixtureCase.errors.length + fixtureCase.newErrors.length
      : null;

    if (classification.status !== "executable") {
      records.push({
        id: fixtureCase.id,
        baseId: fixtureCase.baseId,
        file: fixtureCase.file,
        caseNumber: fixtureCase.caseNumber,
        scriptingEnabled: fixtureCase.scriptingEnabled,
        partition,
        status: classification.status,
        reason: classification.reason,
        expectedTreeSha256,
        actualTreeSha256: null,
        expectedParseErrors,
        actualParseErrors: null,
        parseErrorCountMatches: null,
        parseErrorsSha256: null,
        error: null
      });
      continue;
    }

    try {
      const result = buildTreeFromHtml(
        fixtureCase.data,
        TREE_BUDGETS,
        {
          fragmentContextTagName: fixtureCase.fragmentContext?.localName,
          scriptingEnabled: fixtureCase.scriptingEnabled
        }
      );
      const actualTree = normalizeFixtureOutput(normalizeTree(result.document));
      const actualTreeSha256 = sha256(Buffer.from(actualTree, "utf8"));
      const parseErrorsSha256 = sha256(Buffer.from(JSON.stringify(result.errors), "utf8"));
      const treeMatches = actualTree === expectedTree;
      const errorsMatch = expectedParseErrors === null || result.errors.length === expectedParseErrors;
      records.push({
        id: fixtureCase.id,
        baseId: fixtureCase.baseId,
        file: fixtureCase.file,
        caseNumber: fixtureCase.caseNumber,
        scriptingEnabled: fixtureCase.scriptingEnabled,
        partition,
        status: treeMatches ? "pass" : "fail",
        reason: treeMatches ? null : "tree-mismatch",
        expectedTreeSha256,
        actualTreeSha256,
        expectedParseErrors,
        actualParseErrors: result.errors.length,
        parseErrorCountMatches: expectedParseErrors === null ? null : errorsMatch,
        parseErrorsSha256,
        error: null
      });
    } catch (error) {
      records.push({
        id: fixtureCase.id,
        baseId: fixtureCase.baseId,
        file: fixtureCase.file,
        caseNumber: fixtureCase.caseNumber,
        scriptingEnabled: fixtureCase.scriptingEnabled,
        partition,
        status: "fail",
        reason: "parser-threw",
        expectedTreeSha256,
        actualTreeSha256: null,
        expectedParseErrors,
        actualParseErrors: null,
        parseErrorCountMatches: null,
        parseErrorsSha256: null,
        error: serializeThrown(error)
      });
    }
  }
  return records;
}

function fixtureIdentity(fixtureCase) {
  return JSON.stringify({
    data: fixtureCase.data,
    fragmentContext: fixtureCase.fragmentContext,
    scripting: fixtureCase.scripting
  });
}

async function compareLegacyCoverage(baseCases) {
  const requireLegacyCoverage = process.argv.includes("--require-legacy-coverage");
  let legacyCorpusAvailable = false;
  try {
    legacyCorpusAvailable = (await stat(TREE_FIXTURE_FILES[0])).isFile();
  } catch {
    if (requireLegacyCoverage) {
      throw new Error(
        "legacy tree fixtures are unavailable; run: git submodule update --init --recursive"
      );
    }
  }
  if (!legacyCorpusAvailable) {
    return {
      state: "unavailable",
      reason: "html5lib submodule is not initialized; WPT execution remains complete and offline"
    };
  }

  const wptById = new Map(baseCases.map((fixtureCase) => [fixtureCase.id, fixtureCase]));
  const missing = [];
  const semanticDifferences = [];
  const expectationChanges = [];
  let oldCases = 0;
  for (const legacyPath of TREE_FIXTURE_FILES) {
    const legacyContent = await readFile(legacyPath, "utf8");
    const legacyCases = parseTreeDatFixtures(legacyContent, legacyPath);
    for (const legacyCase of legacyCases) {
      oldCases += 1;
      const wptId = `resources/${path.basename(legacyPath)}#${String(legacyCase.caseNumber)}`;
      const wptCase = wptById.get(wptId);
      if (wptCase === undefined) {
        missing.push({ legacyId: legacyCase.id, expectedWptId: wptId });
        continue;
      }
      if (fixtureIdentity(legacyCase) !== fixtureIdentity(wptCase)) {
        semanticDifferences.push({ legacyId: legacyCase.id, wptId });
      }
      if (normalizeFixtureOutput(legacyCase.expected) !== normalizeFixtureOutput(wptCase.expected)) {
        expectationChanges.push({ legacyId: legacyCase.id, wptId });
      }
    }
  }

  return {
    state: "compared",
    legacyRevision: "8f43b7ec8c9d02179f5f38e0ea08cb5000fb9c9e",
    oldCases,
    represented: oldCases - missing.length,
    missing,
    semanticDifferences,
    expectationChanges,
    wptBaseCases: baseCases.length,
    equalOrGreaterCoverage:
      missing.length === 0 && semanticDifferences.length === 0 && baseCases.length >= oldCases
  };
}

function createBaseline(corpus, records) {
  return {
    schemaVersion: 1,
    corpusCommit: corpus.manifest.commit,
    corpusCompositeSha256: corpus.compositeSha256,
    cases: summarize(records),
    parseErrors: summarizeParseErrors(records),
    outcomeSha256: outcomeDigest(records)
  };
}

async function main() {
  const corpus = await verifyWptTreeCorpus();
  const { baseCases, executionCases } = await loadWptCases(corpus);
  const firstRecords = runCases(executionCases);
  const secondRecords = runCases(executionCases);
  if (JSON.stringify(firstRecords) !== JSON.stringify(secondRecords)) {
    throw new Error("WPT tree results are not deterministic across two consecutive runs");
  }

  const baseline = createBaseline(corpus, firstRecords);
  if (process.argv.includes("--update-baseline")) {
    await writeJson(BASELINE_PATH, baseline);
  } else {
    const expectedBaseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
    if (JSON.stringify(baseline) !== JSON.stringify(expectedBaseline)) {
      throw new Error(
        `legacy WPT result baseline changed; inspect the report before running with --update-baseline`
      );
    }
  }

  const legacyCoverage = await compareLegacyCoverage(baseCases);
  if (legacyCoverage.state === "compared" && !legacyCoverage.equalOrGreaterCoverage) {
    throw new Error("current WPT snapshot does not preserve the pinned legacy tree-case surface");
  }

  const primaryRecords = firstRecords.filter((record) => record.partition === "current-primary");
  const holdoutRecords = firstRecords.filter((record) => record.partition === "current-holdout");
  const skips = firstRecords
    .filter((record) => record.status === "unsupported" || record.status === "inapplicable")
    .map((record) => ({
      id: record.id,
      status: record.status,
      reason: record.reason
    }));
  const failures = firstRecords
    .filter((record) => record.status === "fail")
    .map((record) => ({
      id: record.id,
      reason: record.reason,
      expectedTreeSha256: record.expectedTreeSha256,
      actualTreeSha256: record.actualTreeSha256,
      expectedParseErrors: record.expectedParseErrors,
      actualParseErrors: record.actualParseErrors,
      parseErrorCountMatches: record.parseErrorCountMatches,
      parseErrorsSha256: record.parseErrorsSha256,
      error: record.error
    }));
  const parseErrorMismatches = firstRecords
    .filter((record) => record.parseErrorCountMatches === false)
    .map((record) => ({
      id: record.id,
      expectedParseErrors: record.expectedParseErrors,
      actualParseErrors: record.actualParseErrors,
      parseErrorsSha256: record.parseErrorsSha256
    }));

  await writeJson("reports/wpt-tree.json", {
    suite: "wpt-tree",
    timestamp: nowIso(),
    corpus: {
      repository: corpus.manifest.repository,
      commit: corpus.manifest.commit,
      compositeSha256: corpus.compositeSha256,
      fixtureFiles: corpus.manifest.statistics.fixtureFiles,
      fixtureBytes: corpus.manifest.statistics.fixtureBytes,
      baseCases: corpus.manifest.statistics.baseCases,
      executionVariants: corpus.manifest.statistics.executionVariants
    },
    deterministic: true,
    outcomeSha256: baseline.outcomeSha256,
    cases: baseline.cases,
    parseErrors: baseline.parseErrors,
    partitions: {
      rule: HOLDOUT_RULE,
      mod: HOLDOUT_MOD,
      primary: summarize(primaryRecords),
      holdout: summarize(holdoutRecords)
    },
    legacyCoverage,
    skips,
    failures,
    parseErrorMismatches
  });

  console.log(
    `WPT tree corpus cases=${String(baseline.cases.total)} passed=${String(baseline.cases.passed)} ` +
      `failed=${String(baseline.cases.failed)} unsupported=${String(baseline.cases.unsupported)} ` +
      `inapplicable=${String(baseline.cases.inapplicable)} deterministic=true`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
