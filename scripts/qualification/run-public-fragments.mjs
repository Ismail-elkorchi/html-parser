import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseFragment } from "../../dist/mod.js";
import { normalizePublicTree } from "../../test/support/public-tree-fixture-adapter.mjs";
import { expandTreeDatCases, parseTreeDatFixtures } from "../../test/support/tree-dat.mjs";
import { verifyWptTreeCorpus } from "../../test/support/wpt-tree-corpus.mjs";
import { writeJson } from "../eval/eval-primitives.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function reportPath() {
  const prefix = "--report=";
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ??
    "reports/public-fragments.json";
}

const corpus = await verifyWptTreeCorpus();
const failures = [];
const outcomes = [];
let baseCases = 0;
let executions = 0;

for (const relativePath of corpus.fixtureFiles) {
  const filePath = path.join(corpus.corpusRoot, relativePath);
  const fixtureCases = parseTreeDatFixtures(await readFile(filePath, "utf8"), filePath)
    .filter((fixtureCase) => fixtureCase.fragmentContext !== null);
  baseCases += fixtureCases.length;
  for (const fixtureCase of expandTreeDatCases(fixtureCases, { includeModeInId: true })) {
    executions += 1;
    const fragment = parseFragment(
      fixtureCase.data,
      { ...fixtureCase.fragmentContext, attributes: [] },
      {
        scriptingMode: fixtureCase.scriptingEnabled ? "inert" : "disabled",
        budgets: {
          maxNodes: 100_000,
          maxDepth: 10_000,
          maxParseErrors: 100_000,
          maxAttributesPerElement: 10_000,
          maxAttributeBytes: 10_000_000
        }
      }
    );
    const actual = normalizePublicTree(fragment);
    const actualUnnamedParseErrorCount = fragment.errors.length;
    const actualNamedParseErrorCount = fragment.errors
      .filter((error) => error.parseErrorId !== "unexpected-token").length;
    const unnamedParseErrorCountMatches =
      !fixtureCase.sawUnnamedErrors ||
      actualUnnamedParseErrorCount === fixtureCase.unnamedErrors.length;
    const namedParseErrorCountMatches =
      !fixtureCase.sawNamedErrors ||
      actualNamedParseErrorCount === fixtureCase.namedErrors.length;
    const outcome = {
      id: fixtureCase.id,
      treeSha256: sha256(actual),
      parseErrors: fragment.errors.map((error) => error.parseErrorId)
    };
    outcomes.push(outcome);
    if (
      actual !== fixtureCase.expected ||
      !unnamedParseErrorCountMatches ||
      !namedParseErrorCountMatches
    ) {
      failures.push({
        id: fixtureCase.id,
        expected: fixtureCase.expected,
        actual,
        expectedParseErrors: {
          unnamed: fixtureCase.sawUnnamedErrors ? fixtureCase.unnamedErrors.length : null,
          named: fixtureCase.sawNamedErrors ? fixtureCase.namedErrors.length : null
        },
        actualParseErrors: {
          unnamed: actualUnnamedParseErrorCount,
          named: actualNamedParseErrorCount
        }
      });
    }
  }
}

const report = {
  schema: "public-fragment-wpt/v1",
  generatedAt: new Date().toISOString(),
  implementation: "dist/mod.js#parseFragment",
  corpusCommit: corpus.manifest.commit,
  corpusCompositeSha256: corpus.compositeSha256,
  baseCases,
  executions,
  exactPasses: executions - failures.length,
  failures,
  outcomesSha256: sha256(JSON.stringify(outcomes))
};
await writeJson(reportPath(), report);
console.log(JSON.stringify(report));
if (failures.length > 0) process.exitCode = 1;
