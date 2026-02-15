import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

export function clamp01(x) {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function scoreFromThresholdToPerfect(passRate, minPassRate) {
  const p = clamp01(passRate);
  const min = clamp01(minPassRate);
  if (p <= min) return 0;
  if (p >= 1) return 1;
  const denom = 1 - min;
  if (denom <= 0) return 1;
  return clamp01((p - min) / denom);
}

export async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(p) {
  const text = await readFile(p, "utf8");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON in ${p}: ${err?.message || String(err)}`);
  }
}

export async function writeJson(p, obj) {
  const full = resolve(p);
  await mkdir(dirname(full), { recursive: true });
  const text = JSON.stringify(obj, null, 2) + "\n";
  await writeFile(full, text, "utf8");
}

export function sha256Bytes(buf) {
  const h = createHash("sha256");
  h.update(buf);
  return `sha256:${h.digest("hex")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function safeDiv(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return a / b;
}

export function geometricMean(values) {
  const xs = values.filter((v) => Number.isFinite(v) && v > 0);
  if (xs.length === 0) return 0;
  const logSum = xs.reduce((acc, v) => acc + Math.log(v), 0);
  return Math.exp(logSum / xs.length);
}

export function normalizeCaseCounts(report) {
  const cases = report?.cases || {};
  const passed = Number(cases.passed || 0);
  const failed = Number(cases.failed || 0);
  const skipped = Number(cases.skipped || 0);
  const total = Number(cases.total || passed + failed + skipped);

  return { passed, failed, skipped, total, executed: passed + failed };
}

export async function requireExistingDecisionRecords(skips) {
  const missing = [];
  for (const s of skips || []) {
    const dr = s?.decisionRecord;
    if (!dr || typeof dr !== "string") {
      missing.push({ id: s?.id || "(unknown)", reason: "missing decisionRecord field" });
      continue;
    }
    if (!(await fileExists(dr))) {
      missing.push({ id: s?.id || "(unknown)", reason: `decision record not found: ${dr}` });
    }
  }
  return missing;
}
