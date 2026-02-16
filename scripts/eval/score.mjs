import {
  nowIso,
  readJson,
  writeJson,
  fileExists,
  normalizeCaseCounts,
  safeDiv,
  scoreFromThresholdToPerfect,
  geometricMean
} from "./eval-primitives.mjs";

async function loadRequired(path) {
  if (!(await fileExists(path))) throw new Error(`Missing required report: ${path}`);
  return await readJson(path);
}

async function loadOptional(path) {
  if (!(await fileExists(path))) return null;
  return await readJson(path);
}

function passRate(report) {
  const { passed, failed, executed } = normalizeCaseCounts(report);
  const executedCaseCount = executed === 0 ? (passed + failed) : executed;
  return safeDiv(passed, executedCaseCount);
}

function weighted(points, fraction01) {
  return points * Math.max(0, Math.min(1, fraction01));
}

function parseProfileArg() {
  const profileArg = process.argv.find((argumentValue) => argumentValue.startsWith("--profile="));
  return profileArg ? profileArg.split("=")[1] : "ci";
}

async function main() {
  const profile = parseProfileArg();

  const config = await loadRequired("evaluation.config.json");
  if (!config.profiles?.[profile]) throw new Error(`Unknown profile: ${profile}`);

  const weights = config.weights || {};

  const tokenizer = await loadRequired("reports/tokenizer.json");
  const tree = await loadRequired("reports/tree.json");
  const encoding = await loadRequired("reports/encoding.json");
  const serializer = await loadRequired("reports/serializer.json");

  const conformanceThresholds = config.thresholds?.conformance || {};
  const tokenizerPassRate = passRate(tokenizer);
  const treePassRate = passRate(tree);
  const encodingPassRate = passRate(encoding);
  const serializerPassRate = passRate(serializer);

  const correctnessPoints = Number(weights.correctness || 40);

  const tokenizerPoints = correctnessPoints * (10 / 40);
  const treePoints = correctnessPoints * (15 / 40);
  const encodingPoints = correctnessPoints * (7.5 / 40);
  const serializerPoints = correctnessPoints * (7.5 / 40);

  const tokenizerScoreFraction =
    scoreFromThresholdToPerfect(tokenizerPassRate, conformanceThresholds.tokenizer.minPassRate);
  const treeScoreFraction = scoreFromThresholdToPerfect(treePassRate, conformanceThresholds.tree.minPassRate);
  const encodingScoreFraction =
    scoreFromThresholdToPerfect(encodingPassRate, conformanceThresholds.encoding.minPassRate);
  const serializerScoreFraction =
    scoreFromThresholdToPerfect(serializerPassRate, conformanceThresholds.serializer.minPassRate);

  const correctnessScore =
    weighted(tokenizerPoints, tokenizerScoreFraction) +
    weighted(treePoints, treeScoreFraction) +
    weighted(encodingPoints, encodingScoreFraction) +
    weighted(serializerPoints, serializerScoreFraction);

  const browserDiffPoints = Number(weights.browserDiff || 20);
  const browserDiffReport = await loadOptional("reports/browser-diff.json");

  let browserDiffScore = 0;
  let browserAgreement = null;

  if (browserDiffReport) {
    const engines = browserDiffReport.engines || {};
    const presentEngines = Object.keys(engines).filter((engineName) => Number(engines[engineName]?.compared || 0) > 0);
    const agreementRatios = presentEngines.map((engineName) =>
      safeDiv(Number(engines[engineName]?.agreed || 0), Number(engines[engineName]?.compared || 0))
    );

    const aggregateAgreement = config.scoring?.browserAgreementAggregation === "min"
      ? (agreementRatios.length ? Math.min(...agreementRatios) : 0)
      : (agreementRatios.length
        ? agreementRatios.reduce((ratioSum, ratio) => ratioSum + ratio, 0) / agreementRatios.length
        : 0);

    browserAgreement = { presentEngines, agreement: aggregateAgreement };

    const minAgreement = config.thresholds?.browserDiff?.minAgreement ?? 0.995;
    const agreementFraction = scoreFromThresholdToPerfect(aggregateAgreement, minAgreement);
    browserDiffScore = weighted(browserDiffPoints, agreementFraction);
  } else {
    browserAgreement = { missing: true };
    browserDiffScore = 0;
  }

  const perfPoints = Number(weights.performance || 15);
  const bench = await loadOptional("reports/bench.json");

  let performanceScore = 0;
  let performanceDetail = { missing: true };

  if (bench) {
    const baseline = config.performanceBaseline?.benchmarks || {};
    const ratios = [];

    for (const benchmarkEntry of bench.benchmarks || []) {
      const baselineEntry = baseline[benchmarkEntry.name];
      if (!baselineEntry) continue;

      const throughputMbPerSec = Number(benchmarkEntry.mbPerSec || 0);
      const memoryMb = Number(benchmarkEntry.memoryMB || 0);
      const baselineThroughputMbPerSec = Number(baselineEntry.mbPerSec || 0);
      const baselineMemoryMb = Number(baselineEntry.memoryMB || 0);

      const throughputRatio = safeDiv(throughputMbPerSec, baselineThroughputMbPerSec);
      const memoryRatio = safeDiv(baselineMemoryMb, memoryMb);

      ratios.push(geometricMean([throughputRatio, memoryRatio]));
    }

    const aggregatePerformanceRatio = config.scoring?.performanceAggregation === "geometricMean"
      ? geometricMean(ratios)
      : (ratios.length ? ratios.reduce((ratioSum, ratio) => ratioSum + ratio, 0) / ratios.length : 0);

    const boundedPerformanceRatio = Math.max(0, Math.min(1, aggregatePerformanceRatio));
    performanceScore = weighted(perfPoints, boundedPerformanceRatio);
    performanceDetail = { benchmarksCompared: ratios.length, ratio: aggregatePerformanceRatio };
  }

  const robustPoints = Number(weights.robustness || 10);
  const fuzz = await loadOptional("reports/fuzz.json");
  const budgets = await loadOptional("reports/budgets.json");

  let robustnessScore = 0;
  let robustnessDetail = { fuzz: fuzz || { missing: true }, budgets: budgets || { missing: true } };

  if (fuzz || budgets) {
    const crashes = Number(fuzz?.crashes || 0);
    const hangs = Number(fuzz?.hangs || 0);
    const budgetsOk = budgets ? Boolean(budgets?.overall?.ok) : true;

    if (crashes > 0 || hangs > 0 || !budgetsOk) {
      robustnessScore = 0;
    } else {
      robustnessScore = robustPoints;
    }
  }

  const agentPoints = Number(weights.agentFirst || 10);
  const agent = await loadOptional("reports/agent.json");

  let agentScore = 0;
  let agentDetail = agent || { missing: true };

  if (agent) {
    const agentFeatures = agent.features || {};
    const enabledFeatureCount = ["trace", "spans", "outline", "chunk"].filter(
      (featureName) => Boolean(agentFeatures?.[featureName]?.ok)
    ).length;
    const featureCoverage = enabledFeatureCount / 4;
    agentScore = weighted(agentPoints, featureCoverage);
  }

  const packPoints = Number(weights.packagingTrust || 5);
  const pack = await loadOptional("reports/pack.json");
  const docs = await loadOptional("reports/docs.json");

  const packOk = Boolean(pack?.ok);
  const docsOk = Boolean(docs?.ok);
  const frac = (packOk ? 0.6 : 0) + (docsOk ? 0.4 : 0);
  const packagingScore = weighted(packPoints, frac);

  const total =
    correctnessScore +
    browserDiffScore +
    performanceScore +
    robustnessScore +
    agentScore +
    packagingScore;

  const scoreReport = {
    suite: "score",
    timestamp: nowIso(),
    profile,
    total,
    breakdown: {
      correctness: {
        score: correctnessScore,
        details: {
          tokenizerPassRate,
          treePassRate,
          encodingPassRate,
          serializerPassRate
        }
      },
      browserDiff: { score: browserDiffScore, details: browserAgreement },
      performance: { score: performanceScore, details: performanceDetail },
      robustness: { score: robustnessScore, details: robustnessDetail },
      agentFirst: { score: agentScore, details: agentDetail },
      packagingTrust: { score: packagingScore, details: { packOk, docsOk } }
    }
  };

  await writeJson("reports/score.json", scoreReport);

  console.log(`EVAL: Total score (${profile}): ${total.toFixed(3)}/100`);
}

main().catch((error) => {
  console.error("EVAL:", error);
  process.exit(1);
});
