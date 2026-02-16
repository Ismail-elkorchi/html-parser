import { readFile } from "node:fs/promises";
import {
  nowIso,
  readJson,
  writeJson,
  fileExists,
  normalizeCaseCounts,
  safeDiv,
  requireExistingDecisionRecords
} from "./util.mjs";

function makeGate(id, name, pass, details) {
  return { id, name, pass, details };
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
    console.error("EVAL: Gate failures detected. See reports/gates.json");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
