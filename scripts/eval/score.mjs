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

const SCORE_WEIGHT_KEYS = [
  "correctness",
  "browserDiff",
  "performance",
  "robustness",
  "agentFirst",
  "packagingTrust"
];

function resolveWeights(config, profile) {
  const profileWeights = config.profiles?.[profile]?.weights;
  const hasProfileWeights = profileWeights !== null && typeof profileWeights === "object" && !Array.isArray(profileWeights);
  const selectedWeights = hasProfileWeights ? profileWeights : (config.weights || {});

  for (const key of SCORE_WEIGHT_KEYS) {
    const value = selectedWeights[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid score weight for ${key} in ${hasProfileWeights ? `profiles.${profile}.weights` : "weights"}`);
    }
  }

  const total = SCORE_WEIGHT_KEYS.reduce((sum, key) => sum + Number(selectedWeights[key]), 0);
  if (Math.abs(total - 100) > 1e-9) {
    throw new Error(`Score weights must sum to 100; got ${total.toFixed(6)} for ${hasProfileWeights ? `profiles.${profile}.weights` : "weights"}`);
  }

  return {
    source: hasProfileWeights ? `profiles.${profile}.weights` : "weights",
    values: Object.fromEntries(SCORE_WEIGHT_KEYS.map((key) => [key, Number(selectedWeights[key])])),
    total
  };
}

async function main() {
  const profile = parseProfileArg();

  const config = await loadRequired("evaluation.config.json");
  const profilePolicy = config.profiles?.[profile];
  if (!profilePolicy) throw new Error(`Unknown profile: ${profile}`);

  const resolvedWeights = resolveWeights(config, profile);
  const weights = resolvedWeights.values;
  const conformanceThresholds = config.thresholds?.conformance || {};

  const correctnessPoints = Number(weights.correctness);
  let correctnessScore = 0;
  let correctnessDetails = { skippedByWeight: true };
  if (correctnessPoints > 0) {
    const tokenizer = await loadRequired("reports/tokenizer.json");
    const tree = await loadRequired("reports/tree.json");
    const encoding = await loadRequired("reports/encoding.json");
    const serializer = await loadRequired("reports/serializer.json");

    const tokenizerPassRate = passRate(tokenizer);
    const treePassRate = passRate(tree);
    const encodingPassRate = passRate(encoding);
    const serializerPassRate = passRate(serializer);

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

    correctnessScore =
      weighted(tokenizerPoints, tokenizerScoreFraction) +
      weighted(treePoints, treeScoreFraction) +
      weighted(encodingPoints, encodingScoreFraction) +
      weighted(serializerPoints, serializerScoreFraction);

    correctnessDetails = {
      tokenizerPassRate,
      treePassRate,
      encodingPassRate,
      serializerPassRate
    };
  }

  const browserDiffPoints = Number(weights.browserDiff);

  let browserDiffScore = 0;
  let browserAgreement = { skippedByWeight: browserDiffPoints === 0 };
  if (browserDiffPoints > 0) {
    const browserDiffReport = await loadOptional("reports/browser-diff.json");
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
  } else {
    browserDiffScore = 0;
  }

  const perfPoints = Number(weights.performance);
  let performanceScore = 0;
  let performanceDetail = { skippedByWeight: perfPoints === 0 };
  if (perfPoints > 0) {
    const bench = await loadOptional("reports/bench.json");
    performanceDetail = { missing: true };
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
  }

  const robustPoints = Number(weights.robustness);
  let robustnessScore = 0;
  let robustnessDetail = { skippedByWeight: robustPoints === 0 };
  if (robustPoints > 0) {
    const requireBudgetsReport = profilePolicy.requireBudgetsReport !== false;
    const robustnessUsesFuzz = Boolean(profilePolicy.robustnessUsesFuzz);
    const budgets = await loadOptional("reports/budgets.json");
    const fuzz = robustnessUsesFuzz ? await loadOptional("reports/fuzz.json") : null;

    const budgetsOk = requireBudgetsReport ? Boolean(budgets?.overall?.ok) : true;
    const fuzzCrashes = Number(fuzz?.crashes || 0);
    const fuzzHangs = Number(fuzz?.hangs || 0);
    const fuzzOk = robustnessUsesFuzz ? Boolean(fuzz) && fuzzCrashes === 0 && fuzzHangs === 0 : true;

    robustnessScore = budgetsOk && fuzzOk ? robustPoints : 0;
    robustnessDetail = {
      requireBudgetsReport,
      robustnessUsesFuzz,
      budgets: budgets || { missing: true },
      fuzz: robustnessUsesFuzz ? (fuzz || { missing: true }) : { skippedByPolicy: true },
      budgetsOk,
      fuzzOk
    };
  }

  const agentPoints = Number(weights.agentFirst);
  let agentScore = 0;
  let agentDetail = { skippedByWeight: agentPoints === 0 };
  if (agentPoints > 0) {
    const agent = await loadOptional("reports/agent.json");
    agentDetail = agent || { missing: true };
    if (agent) {
      const agentFeatures = agent.features || {};
      const enabledFeatureCount = ["trace", "spans", "patch", "outline", "chunk", "streamToken"].filter(
        (featureName) => Boolean(agentFeatures?.[featureName]?.ok)
      ).length;
      const featureCoverage = enabledFeatureCount / 6;
      agentScore = weighted(agentPoints, featureCoverage);
    }
  }

  const packPoints = Number(weights.packagingTrust);
  let packagingScore = 0;
  let packagingDetails = { skippedByWeight: packPoints === 0 };
  if (packPoints > 0) {
    const pack = await loadOptional("reports/pack.json");
    const docs = await loadOptional("reports/docs.json");

    const packOk = Boolean(pack?.ok);
    const docsOk = Boolean(docs?.ok);
    const frac = (packOk ? 0.6 : 0) + (docsOk ? 0.4 : 0);
    packagingScore = weighted(packPoints, frac);
    packagingDetails = { packOk, docsOk };
  }

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
    weightsUsed: resolvedWeights,
    total,
    breakdown: {
      correctness: {
        score: correctnessScore,
        details: correctnessDetails
      },
      browserDiff: { score: browserDiffScore, details: browserAgreement },
      performance: { score: performanceScore, details: performanceDetail },
      robustness: { score: robustnessScore, details: robustnessDetail },
      agentFirst: { score: agentScore, details: agentDetail },
      packagingTrust: { score: packagingScore, details: packagingDetails }
    }
  };

  await writeJson("reports/score.json", scoreReport);

  console.log(`Total score (${profile}): ${total.toFixed(3)}/100`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
