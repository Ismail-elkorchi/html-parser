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

function gate(id, name, pass, details) {
  return { id, name, pass, details };
}

async function loadOptionalReport(path) {
  if (!(await fileExists(path))) return null;
  return await readJson(path);
}

async function main() {
  const profile = (process.argv.find((a) => a.startsWith("--profile=")) || "--profile=ci").split("=")[1];

  if (!(await fileExists("evaluation.config.json"))) {
    console.error("Missing evaluation.config.json");
    process.exit(1);
  }

  const config = await readJson("evaluation.config.json");
  const prof = config.profiles?.[profile];
  if (!prof) {
    console.error(`Unknown profile: ${profile}`);
    process.exit(1);
  }

  if (!(await fileExists("package.json"))) {
    console.error("Missing package.json");
    process.exit(1);
  }
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  const gates = [];

  gates.push(gate("G-000", "Evaluation config exists", true, { profile }));

  const deps = pkg.dependencies;
  const depsIsObject = deps !== null && typeof deps === "object" && !Array.isArray(deps);
  const depsCount = depsIsObject ? Object.keys(deps).length : -1;
  const depsEmptyObject = depsIsObject && depsCount === 0;
  gates.push(gate("G-010", "Zero runtime dependencies", depsEmptyObject, {
    dependenciesType: deps === undefined ? "undefined" : typeof deps,
    dependenciesCount: depsCount
  }));

  const noExternalImports = await loadOptionalReport("reports/no-external-imports.json");
  gates.push(
    gate(
      "G-012",
      "No external imports in dist/",
      Boolean(noExternalImports?.ok),
      noExternalImports || { missing: true }
    )
  );

  const runtimeSelfContained = await loadOptionalReport("reports/runtime-self-contained.json");
  gates.push(
    gate(
      "G-015",
      "Runtime self-contained",
      Boolean(runtimeSelfContained?.ok),
      runtimeSelfContained || { missing: true }
    )
  );

  const esmTypeOk = pkg.type === "module";
  const exportsStr = JSON.stringify(pkg.exports || {});
  const noRequireKeys = !exportsStr.includes('"require"');
  const esmOnly = esmTypeOk && noRequireKeys;
  gates.push(gate("G-020", "ESM only", esmOnly, { type: pkg.type, requireKeysPresent: !noRequireKeys }));

  const noNodeBuiltins = await loadOptionalReport("reports/no-node-builtins.json");
  gates.push(
    gate(
      "G-030",
      "No Node builtin imports in src/",
      Boolean(noNodeBuiltins?.ok),
      noNodeBuiltins || { missing: true }
    )
  );

  async function conformanceGate(gid, name, reportPath, threshold, options = {}) {
    const report = await loadOptionalReport(reportPath);
    if (!report) {
      gates.push(gate(gid, name, false, { missingReport: reportPath }));
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
      gate(gid, name, pass, {
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

  const t = config.thresholds?.conformance || {};
  await conformanceGate("G-040", "Conformance tokenizer", "reports/tokenizer.json", t.tokenizer, {
    enforceHoldoutDiscipline: true
  });
  await conformanceGate("G-050", "Conformance tree construction", "reports/tree.json", t.tree, {
    enforceHoldoutDiscipline: true
  });
  await conformanceGate("G-060", "Conformance encoding", "reports/encoding.json", t.encoding, {
    enforceHoldoutDiscipline: true
  });
  await conformanceGate("G-070", "Conformance serializer", "reports/serializer.json", t.serializer, {
    enforceHoldoutDiscipline: true
  });

  const det = await loadOptionalReport("reports/determinism.json");
  const detOk = Boolean(det?.overall?.ok);
  gates.push(gate("G-080", "Determinism", detOk, det || { missing: true }));

  const budgets = await loadOptionalReport("reports/budgets.json");
  const fuzz = await loadOptionalReport("reports/fuzz.json");
  const requireBudgetsReport = Boolean(config.thresholds?.budgets?.requireBudgetsReport);
  const requireFuzzReport = Boolean(config.thresholds?.budgets?.requireFuzzReport) && Boolean(prof.requireFuzzReport);

  const budgetsOk =
    (budgets ? Boolean(budgets?.overall?.ok) : true) &&
    (fuzz ? (Number(fuzz.hangs || 0) === 0 && Number(fuzz.crashes || 0) === 0) : true);

  const budgetsPass = requireBudgetsReport ? Boolean(budgets?.overall?.ok) : budgetsOk;

  gates.push(
    gate(
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
    (!prof.requireDeno || denoOk) &&
    (!prof.requireBun || bunOk) &&
    (!prof.requireBrowserSmoke || browserOk);

  gates.push(gate("G-100", "Cross-runtime smoke", smokePass, smoke || { missing: true }));

  const pack = await loadOptionalReport("reports/pack.json");
  gates.push(gate("G-110", "Packaging sanity", Boolean(pack?.ok), pack || { missing: true }));

  const docs = await loadOptionalReport("reports/docs.json");
  gates.push(gate("G-120", "Docs and dataset hygiene", Boolean(docs?.ok), docs || { missing: true }));

  if (prof.requireHoldouts) {
    await conformanceGate("R-200", "Holdout suite", "reports/holdout.json", t.holdout);
  }

  if (prof.requireBrowserDiff) {
    const bd = await loadOptionalReport("reports/browser-diff.json");
    const minAgreement = config.thresholds?.browserDiff?.minAgreement ?? 0.995;
    const minEnginesPresent = config.thresholds?.browserDiff?.minEnginesPresent ?? 1;
    const minCases = config.thresholds?.browserDiff?.minCases ?? 1;
    const minTagCoverage = config.thresholds?.browserDiff?.minTagCoverage ?? 0;
    const requiredTags = Array.isArray(config.thresholds?.browserDiff?.requiredTags)
      ? config.thresholds.browserDiff.requiredTags
      : [];

    if (!bd) {
      gates.push(gate("R-210", "Browser differential oracle", false, { missingReport: "reports/browser-diff.json" }));
    } else {
      const engines = bd.engines || {};
      const present = Object.keys(engines).filter((k) => Number(engines[k]?.compared || 0) > 0);

      const agreements = present.map((k) => safeDiv(Number(engines[k]?.agreed || 0), Number(engines[k]?.compared || 0)));
      const agg = config.scoring?.browserAgreementAggregation === "min"
        ? (agreements.length ? Math.min(...agreements) : 0)
        : (agreements.length ? agreements.reduce((a, b) => a + b, 0) / agreements.length : 0);

      const totalCases = Number(bd?.corpus?.totalCases ?? bd?.corpus?.cases ?? 0);
      const tagCounts = bd?.coverage?.tagCounts && typeof bd.coverage.tagCounts === "object"
        ? bd.coverage.tagCounts
        : {};
      const underCoveredTags = requiredTags.filter((tag) => Number(tagCounts[tag] ?? 0) < minTagCoverage);

      const pass =
        present.length >= minEnginesPresent &&
        agg >= minAgreement &&
        totalCases >= minCases &&
        underCoveredTags.length === 0;

      gates.push(gate("R-210", "Browser differential oracle", pass, {
        presentEngines: present,
        agreement: agg,
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
    gates.push(gate("R-220", "Fuzz report required", fuzzPass, fuzz || { missingReport: "reports/fuzz.json" }));
  }

  const allPass = gates.every((g) => g.pass);

  const out = {
    suite: "gates",
    timestamp: nowIso(),
    profile,
    allPass,
    gates
  };

  await writeJson("reports/gates.json", out);

  if (!allPass) {
    console.error("Gate failures detected. See reports/gates.json");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
