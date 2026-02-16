import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  nowIso,
  readJson,
  writeJson,
  fileExists,
  normalizeCaseCounts,
  safeDiv,
  requireExistingDecisionRecords
} from "./eval-primitives.mjs";

function makeGate(gateId, gateName, gatePass, gateDetails) {
  return { id: gateId, name: gateName, pass: gatePass, details: gateDetails };
}

async function loadOptionalReport(reportPath) {
  if (!(await fileExists(reportPath))) return null;
  return await readJson(reportPath);
}

function parseProfileArg() {
  const profileArg = process.argv.find((argumentValue) => argumentValue.startsWith("--profile="));
  return profileArg ? profileArg.split("=")[1] : "ci";
}

async function main() {
  const profile = parseProfileArg();

  if (!(await fileExists("evaluation.config.json"))) {
    console.error("Missing evaluation.config.json");
    process.exit(1);
  }

  const config = await readJson("evaluation.config.json");
  const profilePolicy = config.profiles?.[profile];
  if (!profilePolicy) {
    console.error(`Unknown profile: ${profile}`);
    process.exit(1);
  }

  if (!(await fileExists("package.json"))) {
    console.error("Missing package.json");
    process.exit(1);
  }
  const packageManifest = JSON.parse(await readFile("package.json", "utf8"));

  const gates = [];

  gates.push(makeGate("G-000", "Evaluation config exists", true, { profile }));

  const runtimeDependencies = packageManifest.dependencies;
  const hasRuntimeDependencyObject =
    runtimeDependencies !== null &&
    typeof runtimeDependencies === "object" &&
    !Array.isArray(runtimeDependencies);
  const runtimeDependencyCount = hasRuntimeDependencyObject ? Object.keys(runtimeDependencies).length : -1;
  const hasZeroRuntimeDependencies = hasRuntimeDependencyObject && runtimeDependencyCount === 0;
  gates.push(makeGate("G-010", "Zero runtime dependencies", hasZeroRuntimeDependencies, {
    dependenciesType: runtimeDependencies === undefined ? "undefined" : typeof runtimeDependencies,
    dependenciesCount: runtimeDependencyCount
  }));

  const noExternalImports = await loadOptionalReport("reports/no-external-imports.json");
  gates.push(
    makeGate(
      "G-012",
      "No external imports in dist/",
      Boolean(noExternalImports?.ok),
      noExternalImports || { missing: true }
    )
  );

  const runtimeSelfContained = await loadOptionalReport("reports/runtime-self-contained.json");
  gates.push(
    makeGate(
      "G-015",
      "Runtime self-contained",
      Boolean(runtimeSelfContained?.ok),
      runtimeSelfContained || { missing: true }
    )
  );

  const esmTypeOk = packageManifest.type === "module";
  const exportsStr = JSON.stringify(packageManifest.exports || {});
  const noRequireKeys = !exportsStr.includes('"require"');
  const esmOnly = esmTypeOk && noRequireKeys;
  gates.push(makeGate("G-020", "ESM only", esmOnly, { type: packageManifest.type, requireKeysPresent: !noRequireKeys }));

  const noNodeBuiltins = await loadOptionalReport("reports/no-node-builtins.json");
  gates.push(
    makeGate(
      "G-030",
      "No Node builtin imports in src/",
      Boolean(noNodeBuiltins?.ok),
      noNodeBuiltins || { missing: true }
    )
  );

  async function evaluateConformanceGate(gateId, gateName, reportPath, threshold, options = {}) {
    const report = await loadOptionalReport(reportPath);
    if (!report) {
      gates.push(makeGate(gateId, gateName, false, { missingReport: reportPath }));
      return;
    }

    const { passed, failed, skipped, total, executed } = normalizeCaseCounts(report);
    const passRate = safeDiv(passed, executed === 0 ? (passed + failed) : executed);
    const minPassRate = threshold.minPassRate;
    const maxSkips = threshold.maxSkips;
    const holdoutExcluded = Number(report?.holdoutExcluded ?? report?.holdout?.excluded ?? 0);
    const holdoutRule = typeof report?.holdoutRule === "string" ? report.holdoutRule : report?.holdout?.rule;
    const holdoutMod = Number(report?.holdoutMod ?? report?.holdout?.mod ?? Number.NaN);
    const totalSurface = passed + failed + skipped + holdoutExcluded;
    const executedSurface = passed + failed;
    const holdoutExcludedFraction = safeDiv(holdoutExcluded, totalSurface);
    const enforceHoldoutDiscipline = Boolean(options.enforceHoldoutDiscipline);
    const holdoutDisciplinePass =
      !enforceHoldoutDiscipline ||
      (holdoutExcludedFraction >= 0.05 &&
        holdoutExcludedFraction <= 0.15 &&
        typeof holdoutRule === "string" &&
        Number.isFinite(holdoutMod));

    const missingDecisionRecords = await requireExistingDecisionRecords(report.skips);

    const pass =
      passRate >= minPassRate &&
      skipped <= maxSkips &&
      missingDecisionRecords.length === 0 &&
      holdoutDisciplinePass;

    gates.push(
      makeGate(gateId, gateName, pass, {
        passRate,
        minPassRate,
        passed,
        failed,
        skipped,
        total,
        executedSurface,
        totalSurface,
        holdoutExcluded,
        holdoutExcludedFraction,
        holdoutRule,
        holdoutMod,
        holdoutDisciplineRange: { min: 0.05, max: 0.15 },
        holdoutDisciplinePass,
        maxSkips,
        missingDecisionRecords
      })
    );
  }

  const conformanceThresholds = config.thresholds?.conformance || {};
  await evaluateConformanceGate("G-040", "Conformance tokenizer", "reports/tokenizer.json", conformanceThresholds.tokenizer, {
    enforceHoldoutDiscipline: true
  });
  await evaluateConformanceGate("G-050", "Conformance tree construction", "reports/tree.json", conformanceThresholds.tree, {
    enforceHoldoutDiscipline: true
  });
  await evaluateConformanceGate("G-060", "Conformance encoding", "reports/encoding.json", conformanceThresholds.encoding, {
    enforceHoldoutDiscipline: true
  });
  await evaluateConformanceGate(
    "G-070",
    "Conformance serializer",
    "reports/serializer.json",
    conformanceThresholds.serializer,
    {
      enforceHoldoutDiscipline: true
    }
  );

  const determinismReport = await loadOptionalReport("reports/determinism.json");
  const determinismOk = Boolean(determinismReport?.overall?.ok);
  gates.push(makeGate("G-080", "Determinism", determinismOk, determinismReport || { missing: true }));

  const streamReport = await loadOptionalReport("reports/stream.json");
  const requireStreamReport = Boolean(profilePolicy.requireStreamReport);
  const streamOk = Boolean(streamReport?.overall?.ok);
  const streamPass = requireStreamReport ? streamOk : (streamReport ? streamOk : true);
  gates.push(
    makeGate(
      "G-085",
      "Streaming invariants",
      streamPass,
      { required: requireStreamReport, stream: streamReport || { missing: true } }
    )
  );

  const agentReport = await loadOptionalReport("reports/agent.json");
  const requireAgentReport = Boolean(profilePolicy.requireAgentReport);
  const agentOk = Boolean(agentReport?.overall?.ok);
  const agentPass = requireAgentReport ? agentOk : (agentReport ? agentOk : true);
  gates.push(
    makeGate(
      "G-086",
      "Agent feature report",
      agentPass,
      { required: requireAgentReport, agent: agentReport || { missing: true } }
    )
  );

  let exportedVisibleText = false;
  let exportedVisibleTextTokens = false;
  let visibleTextApiError = null;
  try {
    const publicModule = await import(pathToFileURL(resolve("dist/mod.js")).href);
    exportedVisibleText = typeof publicModule.visibleText === "function";
    exportedVisibleTextTokens = typeof publicModule.visibleTextTokens === "function";
  } catch (error) {
    visibleTextApiError = error instanceof Error ? error.message : String(error);
  }

  const visibleTextDocsExists = await fileExists("docs/visible-text.md");
  const visibleTextTestsExists = await fileExists("test/control/visible-text.test.js");

  const fixtureRoot = "test/fixtures/visible-text/v1";
  let fixtureCaseCount = 0;
  let fixtureShapeOk = false;
  let fixtureScanError = null;
  try {
    const fixtureEntries = await readdir(fixtureRoot, { withFileTypes: true });
    const fixtureIds = fixtureEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    fixtureCaseCount = fixtureIds.length;

    let allFixtureFilesPresent = true;
    for (const fixtureId of fixtureIds) {
      const inputPath = `${fixtureRoot}/${fixtureId}/input.html`;
      const expectedTextPath = `${fixtureRoot}/${fixtureId}/expected.txt`;
      const expectedTokensPath = `${fixtureRoot}/${fixtureId}/expected.tokens.json`;
      const hasAllFiles =
        (await fileExists(inputPath)) &&
        (await fileExists(expectedTextPath)) &&
        (await fileExists(expectedTokensPath));
      if (!hasAllFiles) {
        allFixtureFilesPresent = false;
        break;
      }
    }
    fixtureShapeOk = allFixtureFilesPresent && fixtureCaseCount >= 30;
  } catch (error) {
    fixtureScanError = error instanceof Error ? error.message : String(error);
  }

  const agentVisibleTextFeaturePresent = Boolean(agentReport?.features?.visibleText);
  const agentVisibleTextFeatureOk = Boolean(agentReport?.features?.visibleText?.ok);
  const visibleTextGatePass =
    exportedVisibleText &&
    exportedVisibleTextTokens &&
    visibleTextDocsExists &&
    visibleTextTestsExists &&
    fixtureShapeOk &&
    agentVisibleTextFeaturePresent &&
    agentVisibleTextFeatureOk;

  gates.push(
    makeGate(
      "G-087",
      "Visible text contract",
      visibleTextGatePass,
      {
        exportedVisibleText,
        exportedVisibleTextTokens,
        visibleTextApiError,
        visibleTextDocsExists,
        visibleTextTestsExists,
        fixtureRoot,
        fixtureCaseCount,
        fixtureShapeOk,
        fixtureScanError,
        agentVisibleTextFeaturePresent,
        agentVisibleTextFeatureOk
      }
    )
  );

  let exportedGetParseErrorSpecRef = false;
  let parseErrorApiError = null;
  let parseErrorIdsPresent = false;
  let parseErrorIdsDeterministic = false;
  let parseErrorSpecRefStable = false;
  try {
    const publicModule = await import(pathToFileURL(resolve("dist/mod.js")).href);
    exportedGetParseErrorSpecRef = typeof publicModule.getParseErrorSpecRef === "function";

    const malformedHtml = "<div><span></div><p></span>";
    const firstRun = publicModule.parse(malformedHtml, { trace: true });
    const secondRun = publicModule.parse(malformedHtml, { trace: true });
    const firstIds = firstRun.errors.map((entry) => entry.parseErrorId);
    const secondIds = secondRun.errors.map((entry) => entry.parseErrorId);
    parseErrorIdsPresent = firstIds.length > 0 && firstIds.every((entry) => typeof entry === "string" && entry.length > 0);
    parseErrorIdsDeterministic = JSON.stringify(firstIds) === JSON.stringify(secondIds);
    parseErrorSpecRefStable =
      exportedGetParseErrorSpecRef &&
      firstIds.every(
        (entry) =>
          publicModule.getParseErrorSpecRef(entry) === "https://html.spec.whatwg.org/multipage/parsing.html#parse-errors"
      );
  } catch (error) {
    parseErrorApiError = error instanceof Error ? error.message : String(error);
  }

  const parseErrorDocsExists = await fileExists("docs/parse-errors.md");
  const parseErrorTestsExists = await fileExists("test/control/parse-errors.test.js");
  const agentParseErrorFeaturePresent = Boolean(agentReport?.features?.parseErrorId);
  const agentParseErrorFeatureOk = Boolean(agentReport?.features?.parseErrorId?.ok);
  const parseErrorGatePass =
    exportedGetParseErrorSpecRef &&
    parseErrorIdsPresent &&
    parseErrorIdsDeterministic &&
    parseErrorSpecRefStable &&
    parseErrorDocsExists &&
    parseErrorTestsExists &&
    agentParseErrorFeaturePresent &&
    agentParseErrorFeatureOk;

  gates.push(
    makeGate(
      "G-088",
      "Parse error taxonomy contract",
      parseErrorGatePass,
      {
        exportedGetParseErrorSpecRef,
        parseErrorApiError,
        parseErrorIdsPresent,
        parseErrorIdsDeterministic,
        parseErrorSpecRefStable,
        parseErrorDocsExists,
        parseErrorTestsExists,
        agentParseErrorFeaturePresent,
        agentParseErrorFeatureOk
      }
    )
  );

  let spanProvenanceApiError = null;
  let spanProvenancePresent = false;
  let spanProvenanceValuesOk = false;
  let patchRejectsNonInputSpan = false;
  try {
    const publicModule = await import(pathToFileURL(resolve("dist/mod.js")).href);
    const parsed = publicModule.parse("<p>x</p>", { captureSpans: true });
    const nodes = [];
    const stack = [...parsed.children];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || typeof node !== "object") {
        continue;
      }
      nodes.push(node);
      if (node.kind === "element" && Array.isArray(node.children)) {
        stack.push(...node.children);
      }
    }

    spanProvenancePresent =
      nodes.length > 0 &&
      nodes.every((node) => typeof node.spanProvenance === "string");
    spanProvenanceValuesOk = nodes.every((node) =>
      node.spanProvenance === "input" ||
      node.spanProvenance === "inferred" ||
      node.spanProvenance === "none"
    );

    const nonInputNode = nodes.find(
      (node) =>
        node.kind === "element" &&
        typeof node.id === "number" &&
        node.spanProvenance !== "input"
    );

    if (nonInputNode) {
      try {
        publicModule.computePatch("<p>x</p>", [{ kind: "removeNode", target: nonInputNode.id }]);
      } catch (error) {
        patchRejectsNonInputSpan =
          error instanceof publicModule.PatchPlanningError &&
          error.payload?.code === "NON_INPUT_SPAN_PROVENANCE";
      }
    }
  } catch (error) {
    spanProvenanceApiError = error instanceof Error ? error.message : String(error);
  }

  const specMarkdown = await readFile("docs/spec.md", "utf8");
  const spanProvenanceDocumented = specMarkdown.includes("spanProvenance");
  const spansPatchTestsExist = await fileExists("test/control/spans-patch.test.js");
  const spanProvenanceGatePass =
    spanProvenancePresent &&
    spanProvenanceValuesOk &&
    patchRejectsNonInputSpan &&
    spanProvenanceDocumented &&
    spansPatchTestsExist &&
    Boolean(agentReport?.features?.spans?.ok) &&
    Boolean(agentReport?.features?.patch?.ok);

  gates.push(
    makeGate(
      "G-089",
      "Span provenance and patch safety",
      spanProvenanceGatePass,
      {
        spanProvenanceApiError,
        spanProvenancePresent,
        spanProvenanceValuesOk,
        patchRejectsNonInputSpan,
        spanProvenanceDocumented,
        spansPatchTestsExist,
        agentSpansFeatureOk: Boolean(agentReport?.features?.spans?.ok),
        agentPatchFeatureOk: Boolean(agentReport?.features?.patch?.ok)
      }
    )
  );

  const budgets = await loadOptionalReport("reports/budgets.json");
  const fuzz = await loadOptionalReport("reports/fuzz.json");
  const requireBudgetsReport = Boolean(config.thresholds?.budgets?.requireBudgetsReport);
  const requireFuzzReport =
    Boolean(config.thresholds?.budgets?.requireFuzzReport) &&
    Boolean(profilePolicy.requireFuzzReport);

  const budgetsOk =
    (budgets ? Boolean(budgets?.overall?.ok) : true) &&
    (fuzz ? (Number(fuzz.hangs || 0) === 0 && Number(fuzz.crashes || 0) === 0) : true);

  const budgetsPass = requireBudgetsReport ? Boolean(budgets?.overall?.ok) : budgetsOk;

  gates.push(
    makeGate(
      "G-090",
      "Budgets and no hangs",
      budgetsPass,
      {
        budgets: budgets || { missing: true },
        fuzz: fuzz || { missing: true },
        requireFuzzReport
      }
    )
  );

  const smoke = await loadOptionalReport("reports/smoke.json");
  const nodeSmokeOk = Boolean(smoke?.runtimes?.node?.ok);
  const denoOk = Boolean(smoke?.runtimes?.deno?.ok);
  const bunOk = Boolean(smoke?.runtimes?.bun?.ok);
  const browserOk = Boolean(smoke?.runtimes?.browser?.ok);

  const smokePass =
    nodeSmokeOk &&
    (!profilePolicy.requireDeno || denoOk) &&
    (!profilePolicy.requireBun || bunOk) &&
    (!profilePolicy.requireBrowserSmoke || browserOk);

  gates.push(makeGate("G-100", "Cross-runtime smoke", smokePass, smoke || { missing: true }));

  const pack = await loadOptionalReport("reports/pack.json");
  gates.push(makeGate("G-110", "Packaging sanity", Boolean(pack?.ok), pack || { missing: true }));

  const docs = await loadOptionalReport("reports/docs.json");
  gates.push(makeGate("G-120", "Docs and dataset hygiene", Boolean(docs?.ok), docs || { missing: true }));

  const textHygiene = await loadOptionalReport("reports/text-hygiene.json");
  gates.push(
    makeGate(
      "G-125",
      "Text hygiene (no hidden control characters)",
      Boolean(textHygiene?.ok),
      textHygiene || { missing: true }
    )
  );

  const docPolicy = await loadOptionalReport("reports/doc-policy.json");
  gates.push(
    makeGate(
      "G-126",
      "Doc policy coherence",
      Boolean(docPolicy?.ok),
      docPolicy || { missing: true }
    )
  );

  const docSnippets = await loadOptionalReport("reports/doc-snippets.json");
  gates.push(
    makeGate(
      "G-127",
      "Doc TypeScript snippets compile",
      Boolean(docSnippets?.ok),
      docSnippets || { missing: true }
    )
  );

  if (profilePolicy.requireHoldouts) {
    await evaluateConformanceGate("R-200", "Holdout suite", "reports/holdout.json", conformanceThresholds.holdout);
  }

  if (profilePolicy.requireBrowserDiff) {
    const browserDiffReport = await loadOptionalReport("reports/browser-diff.json");
    const minAgreement = config.thresholds?.browserDiff?.minAgreement ?? 0.995;
    const minEnginesPresent = config.thresholds?.browserDiff?.minEnginesPresent ?? 1;
    const minCases = config.thresholds?.browserDiff?.minCases ?? 1;
    const minTagCoverage = config.thresholds?.browserDiff?.minTagCoverage ?? 0;
    const requiredTags = Array.isArray(config.thresholds?.browserDiff?.requiredTags)
      ? config.thresholds.browserDiff.requiredTags
      : [];

    if (!browserDiffReport) {
      gates.push(makeGate("R-210", "Browser differential oracle", false, { missingReport: "reports/browser-diff.json" }));
    } else {
      const engines = browserDiffReport.engines || {};
      const presentEngines = Object.keys(engines).filter((engineName) => Number(engines[engineName]?.compared || 0) > 0);

      const agreementRatios = presentEngines.map((engineName) =>
        safeDiv(Number(engines[engineName]?.agreed || 0), Number(engines[engineName]?.compared || 0))
      );
      const aggregateAgreement = config.scoring?.browserAgreementAggregation === "min"
        ? (agreementRatios.length ? Math.min(...agreementRatios) : 0)
        : (agreementRatios.length ? agreementRatios.reduce((sum, ratio) => sum + ratio, 0) / agreementRatios.length : 0);

      const totalCases = Number(browserDiffReport?.corpus?.totalCases ?? browserDiffReport?.corpus?.cases ?? 0);
      const tagCounts = browserDiffReport?.coverage?.tagCounts && typeof browserDiffReport.coverage.tagCounts === "object"
        ? browserDiffReport.coverage.tagCounts
        : {};
      const underCoveredTags = requiredTags.filter((tag) => Number(tagCounts[tag] ?? 0) < minTagCoverage);

      const pass =
        presentEngines.length >= minEnginesPresent &&
        aggregateAgreement >= minAgreement &&
        totalCases >= minCases &&
        underCoveredTags.length === 0;

      gates.push(makeGate("R-210", "Browser differential oracle", pass, {
        presentEngines,
        agreement: aggregateAgreement,
        minAgreement,
        totalCases,
        minCases,
        minTagCoverage,
        requiredTags,
        underCoveredTags
      }));
    }
  }

  if (requireFuzzReport) {
    const fuzzPass = Boolean(fuzz) && Number(fuzz?.crashes || 0) === 0 && Number(fuzz?.hangs || 0) === 0;
    gates.push(makeGate("R-220", "Fuzz report required", fuzzPass, fuzz || { missingReport: "reports/fuzz.json" }));
  }

  const allPass = gates.every((gateResult) => gateResult.pass);

  const gatesReport = {
    suite: "gates",
    timestamp: nowIso(),
    profile,
    allPass,
    gates
  };

  await writeJson("reports/gates.json", gatesReport);

  if (!allPass) {
    console.error("Gate failures detected. See reports/gates.json");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
