import {
  nowIso,
  readJson,
  writeJson,
  fileExists,
  normalizeCaseCounts,
  safeDiv,
  scoreFromThresholdToPerfect,
  geometricMean
} from "./util.mjs";

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
  const denom = executed === 0 ? (passed + failed) : executed;
  return safeDiv(passed, denom);
}

function weighted(points, fraction01) {
  return points * Math.max(0, Math.min(1, fraction01));
}

async function main() {
  const profile = (process.argv.find((a) => a.startsWith("--profile=")) || "--profile=ci").split("=")[1];

  const config = await loadRequired("evaluation.config.json");
  const prof = config.profiles?.[profile];
  if (!prof) throw new Error(`Unknown profile: ${profile}`);

  const weights = config.weights || {};

  const tokenizer = await loadRequired("reports/tokenizer.json");
  const tree = await loadRequired("reports/tree.json");
  const encoding = await loadRequired("reports/encoding.json");
  const serializer = await loadRequired("reports/serializer.json");

  const t = config.thresholds?.conformance || {};
  const tokRate = passRate(tokenizer);
  const treeRate = passRate(tree);
  const encRate = passRate(encoding);
  const serRate = passRate(serializer);

  const correctnessPoints = Number(weights.correctness || 40);

  const tokPoints = correctnessPoints * (10 / 40);
  const treePoints = correctnessPoints * (15 / 40);
  const encPoints = correctnessPoints * (7.5 / 40);
  const serPoints = correctnessPoints * (7.5 / 40);

  const tokFrac = scoreFromThresholdToPerfect(tokRate, t.tokenizer.minPassRate);
  const treeFrac = scoreFromThresholdToPerfect(treeRate, t.tree.minPassRate);
  const encFrac = scoreFromThresholdToPerfect(encRate, t.encoding.minPassRate);
  const serFrac = scoreFromThresholdToPerfect(serRate, t.serializer.minPassRate);

  const correctnessScore =
    weighted(tokPoints, tokFrac) +
    weighted(treePoints, treeFrac) +
    weighted(encPoints, encFrac) +
    weighted(serPoints, serFrac);

  const browserDiffPoints = Number(weights.browserDiff || 20);
  const bd = await loadOptional("reports/browser-diff.json");

  let browserDiffScore = 0;
  let browserAgreement = null;

  if (bd) {
    const engines = bd.engines || {};
    const present = Object.keys(engines).filter((k) => Number(engines[k]?.compared || 0) > 0);
    const agreements = present.map((k) => safeDiv(Number(engines[k]?.agreed || 0), Number(engines[k]?.compared || 0)));

    const agg = config.scoring?.browserAgreementAggregation === "min"
      ? (agreements.length ? Math.min(...agreements) : 0)
      : (agreements.length ? agreements.reduce((a, b) => a + b, 0) / agreements.length : 0);

    browserAgreement = { presentEngines: present, agreement: agg };

    const minAgreement = config.thresholds?.browserDiff?.minAgreement ?? 0.995;
    const frac = scoreFromThresholdToPerfect(agg, minAgreement);
    browserDiffScore = weighted(browserDiffPoints, frac);
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

    for (const b of bench.benchmarks || []) {
      const base = baseline[b.name];
      if (!base) continue;

      const thr = Number(b.mbPerSec || 0);
      const mem = Number(b.memoryMB || 0);
      const baseThr = Number(base.mbPerSec || 0);
      const baseMem = Number(base.memoryMB || 0);

      const thrRatio = safeDiv(thr, baseThr);
      const memRatio = safeDiv(baseMem, mem);

      ratios.push(geometricMean([thrRatio, memRatio]));
    }

    const agg = config.scoring?.performanceAggregation === "geometricMean"
      ? geometricMean(ratios)
      : (ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0);

    const frac = Math.max(0, Math.min(1, agg));
    performanceScore = weighted(perfPoints, frac);
    performanceDetail = { benchmarksCompared: ratios.length, ratio: agg };
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
    const f = agent.features || {};
    const okCount = ["trace", "spans", "outline", "chunk"].filter((k) => Boolean(f?.[k]?.ok)).length;
    const frac = okCount / 4;
    agentScore = weighted(agentPoints, frac);
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
      correctness: { score: correctnessScore, details: { tokRate, treeRate, encRate, serRate } },
      browserDiff: { score: browserDiffScore, details: browserAgreement },
      performance: { score: performanceScore, details: performanceDetail },
      robustness: { score: robustnessScore, details: robustnessDetail },
      agentFirst: { score: agentScore, details: agentDetail },
      packagingTrust: { score: packagingScore, details: { packOk, docsOk } }
    }
  };

  await writeJson("reports/score.json", scoreReport);

  console.log(`Total score (${profile}): ${total.toFixed(3)}/100`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
