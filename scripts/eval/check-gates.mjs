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

  const deps = pkg.dependencies || {};
  const depsEmpty = Object.keys(deps).length === 0;
  gates.push(gate("G-010", "Zero runtime dependencies", depsEmpty, { dependenciesCount: Object.keys(deps).length }));

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

  async function conformanceGate(gid, name, reportPath, threshold) {
    const report = await loadOptionalReport(reportPath);
    if (!report) {
      gates.push(gate(gid, name, false, { missingReport: reportPath }));
      return;
    }

    const { passed, failed, skipped, total, executed } = normalizeCaseCounts(report);
    const passRate = safeDiv(passed, executed === 0 ? (passed + failed) : executed);
    const minPassRate = threshold.minPassRate;
    const maxSkips = threshold.maxSkips;

    const missingDecisionRecords = await requireExistingDecisionRecords(report.skips);

    const pass =
      passRate >= minPassRate &&
      skipped <= maxSkips &&
      missingDecisionRecords.length === 0;

    gates.push(
      gate(gid, name, pass, {
        passRate,
        minPassRate,
        passed,
        failed,
        skipped,
        total,
        maxSkips,
        missingDecisionRecords
      })
    );
  }

  const t = config.thresholds?.conformance || {};
  await conformanceGate("G-040", "Conformance tokenizer", "reports/tokenizer.json", t.tokenizer);
  await conformanceGate("G-050", "Conformance tree construction", "reports/tree.json", t.tree);
  await conformanceGate("G-060", "Conformance encoding", "reports/encoding.json", t.encoding);
  await conformanceGate("G-070", "Conformance serializer", "reports/serializer.json", t.serializer);

  const det = await loadOptionalReport("reports/determinism.json");
  const detOk = Boolean(det?.overall?.ok);
  gates.push(gate("G-080", "Determinism", detOk, det || { missing: true }));

  const budgets = await loadOptionalReport("reports/budgets.json");
  const fuzz = await loadOptionalReport("reports/fuzz.json");
  const requireBudgetsReport = Boolean(config.thresholds?.budgets?.requireBudgetsReport);

  const budgetsOk =
    (budgets ? Boolean(budgets?.overall?.ok) : true) &&
    (fuzz ? (Number(fuzz.hangs || 0) === 0 && Number(fuzz.crashes || 0) === 0) : true);

  const budgetsPass = requireBudgetsReport ? Boolean(budgets?.overall?.ok) : budgetsOk;

  gates.push(
    gate(
      "G-090",
      "Budgets and no hangs",
      budgetsPass,
      { budgets: budgets || { missing: true }, fuzz: fuzz || { missing: true } }
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

    if (!bd) {
      gates.push(gate("R-210", "Browser differential oracle", false, { missingReport: "reports/browser-diff.json" }));
    } else {
      const engines = bd.engines || {};
      const present = Object.keys(engines).filter((k) => Number(engines[k]?.compared || 0) > 0);

      const agreements = present.map((k) => safeDiv(Number(engines[k]?.agreed || 0), Number(engines[k]?.compared || 0)));
      const agg = config.scoring?.browserAgreementAggregation === "min"
        ? (agreements.length ? Math.min(...agreements) : 0)
        : (agreements.length ? agreements.reduce((a, b) => a + b, 0) / agreements.length : 0);

      const pass = present.length >= minEnginesPresent && agg >= minAgreement;

      gates.push(gate("R-210", "Browser differential oracle", pass, { presentEngines: present, agreement: agg, minAgreement }));
    }
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
