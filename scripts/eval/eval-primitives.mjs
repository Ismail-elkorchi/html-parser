import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

export function clamp01(value01) {
  if (Number.isNaN(value01)) return 0;
  if (value01 < 0) return 0;
  if (value01 > 1) return 1;
  return value01;
}

export function scoreFromThresholdToPerfect(passRate, minPassRate) {
  const boundedPassRate = clamp01(passRate);
  const boundedThreshold = clamp01(minPassRate);
  if (boundedThreshold >= 1) return boundedPassRate >= 1 ? 1 : 0;
  if (boundedPassRate <= boundedThreshold) return 0;
  if (boundedPassRate >= 1) return 1;
  const thresholdSpan = 1 - boundedThreshold;
  if (thresholdSpan <= 0) return 1;
  return clamp01((boundedPassRate - boundedThreshold) / thresholdSpan);
}

export async function fileExists(pathToCheck) {
  try {
    await stat(pathToCheck);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath) {
  const jsonText = await readFile(filePath, "utf8");
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeJson(filePath, jsonValue) {
  const fullPath = resolve(filePath);
  await mkdir(dirname(fullPath), { recursive: true });
  const jsonText = JSON.stringify(jsonValue, null, 2) + "\n";
  await writeFile(fullPath, jsonText, "utf8");
}

export function sha256Bytes(bytes) {
  const digest = createHash("sha256");
  digest.update(bytes);
  return `sha256:${digest.digest("hex")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function safeDiv(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

export function geometricMean(sampleValues) {
  const finitePositiveValues = sampleValues.filter((sampleValue) => Number.isFinite(sampleValue) && sampleValue > 0);
  if (finitePositiveValues.length === 0) return 0;
  const logSum = finitePositiveValues.reduce((sum, sampleValue) => sum + Math.log(sampleValue), 0);
  return Math.exp(logSum / finitePositiveValues.length);
}

export function normalizeCaseCounts(report) {
  const caseCounts = report?.cases || {};
  const passed = Number(caseCounts.passed || 0);
  const failed = Number(caseCounts.failed || 0);
  const skipped = Number(caseCounts.skipped || 0);
  const total = Number(caseCounts.total || passed + failed + skipped);

  return { passed, failed, skipped, total, executed: passed + failed };
}

export async function requireExistingDecisionRecords(skipEntries) {
  const missing = [];
  for (const skipEntry of skipEntries || []) {
    const decisionRecordPath = skipEntry?.decisionRecord;
    if (!decisionRecordPath || typeof decisionRecordPath !== "string") {
      missing.push({ id: skipEntry?.id || "(unknown)", reason: "missing decisionRecord field" });
      continue;
    }
    if (!(await fileExists(decisionRecordPath))) {
      missing.push({ id: skipEntry?.id || "(unknown)", reason: `decision record not found: ${decisionRecordPath}` });
    }
  }
  return missing;
}
