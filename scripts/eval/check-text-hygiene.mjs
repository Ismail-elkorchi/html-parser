import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { nowIso, writeJson } from "./eval-primitives.mjs";

const execFileAsync = promisify(execFile);

const INCLUDED_EXACT_PATHS = new Set([
  "README.md",
  "package.json",
  "jsr.json",
  "eslint.config.mjs"
]);

const INCLUDED_PREFIXES = [
  "docs/",
  "src/",
  "scripts/",
  ".github/"
];

const EXCLUDED_PREFIXES = [
  "vendor/",
  "node_modules/",
  "tmp/",
  "dist/",
  "reports/"
];

const TS_CONFIG_PATTERN = /^tsconfig[^/]*\.json$/;

const BIDI_CODE_POINTS = new Set([
  0x061c,
  0x200e,
  0x200f
]);

const BIDI_RANGES = [
  [0x202a, 0x202e],
  [0x2066, 0x2069]
];

function codePointToHex(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function isBannedCodePoint(codePoint) {
  if (codePoint === 0x0000) {
    return true;
  }

  if (BIDI_CODE_POINTS.has(codePoint)) {
    return true;
  }

  return BIDI_RANGES.some(([rangeStart, rangeEnd]) => codePoint >= rangeStart && codePoint <= rangeEnd);
}

function shouldScanPath(filePath) {
  if (EXCLUDED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    return false;
  }

  if (INCLUDED_EXACT_PATHS.has(filePath)) {
    return true;
  }

  if (INCLUDED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    return true;
  }

  return TS_CONFIG_PATTERN.test(filePath);
}

async function listTrackedPaths() {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    maxBuffer: 1024 * 1024 * 16,
    encoding: "utf8"
  });

  return stdout.split("\0").filter((value) => value.length > 0);
}

function scanFileText(filePath, fileText) {
  const violations = [];
  let charIndex = 0;

  while (charIndex < fileText.length) {
    const codePoint = fileText.codePointAt(charIndex);
    if (codePoint === undefined) {
      break;
    }

    if (isBannedCodePoint(codePoint)) {
      violations.push({
        path: filePath,
        codePointHex: codePointToHex(codePoint),
        index: charIndex
      });
    }

    charIndex += codePoint > 0xffff ? 2 : 1;
  }

  return violations;
}

async function main() {
  const trackedPaths = await listTrackedPaths();
  const scanTargets = trackedPaths.filter((filePath) => shouldScanPath(filePath));

  const violations = [];

  for (const scanTarget of scanTargets) {
    const fileText = await readFile(scanTarget, "utf8");
    violations.push(...scanFileText(scanTarget, fileText));
  }

  const report = {
    suite: "text-hygiene",
    timestamp: nowIso(),
    ok: violations.length === 0,
    scannedFileCount: scanTargets.length,
    violations
  };

  await writeJson("reports/text-hygiene.json", report);

  if (report.ok) {
    return;
  }

  const previewCount = Math.min(20, violations.length);
  console.error(
    `Text hygiene check failed: found ${String(violations.length)} violation(s) across ${String(scanTargets.length)} scanned file(s).`
  );
  for (let violationIndex = 0; violationIndex < previewCount; violationIndex += 1) {
    const violation = violations[violationIndex];
    console.error(
      `${String(violationIndex + 1)}. ${violation.path} index=${String(violation.index)} codePoint=${violation.codePointHex}`
    );
  }
  if (violations.length > previewCount) {
    console.error(`... ${String(violations.length - previewCount)} additional violation(s) omitted`);
  }

  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
