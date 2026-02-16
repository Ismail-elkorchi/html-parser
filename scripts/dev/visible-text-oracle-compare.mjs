import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { parse, visibleText } from "../../dist/mod.js";
import { nowIso, writeJson } from "../eval/eval-primitives.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const FIXTURE_ROOT = resolve(REPO_ROOT, "test/fixtures/visible-text/v1");
const OUTPUT_PATH = resolve(REPO_ROOT, "reports/visible-text-oracle-compare.json");
const WIDTHS = [80, 120];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function tokenizeForSimilarity(value) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length > 0);
}

function tokenCounts(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function tokenF1(expected, actual) {
  const expectedTokens = tokenizeForSimilarity(expected);
  const actualTokens = tokenizeForSimilarity(actual);
  if (expectedTokens.length === 0 && actualTokens.length === 0) {
    return 1;
  }
  if (expectedTokens.length === 0 || actualTokens.length === 0) {
    return 0;
  }
  const expectedCounts = tokenCounts(expectedTokens);
  const actualCounts = tokenCounts(actualTokens);
  let overlap = 0;
  for (const [token, expectedCount] of expectedCounts.entries()) {
    overlap += Math.min(expectedCount, actualCounts.get(token) ?? 0);
  }
  const precision = overlap / actualTokens.length;
  const recall = overlap / expectedTokens.length;
  if (precision === 0 || recall === 0) {
    return 0;
  }
  return (2 * precision * recall) / (precision + recall);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function findBinary(binaryName) {
  const lookup = runCommand("bash", ["-lc", `command -v ${binaryName}`]);
  if (lookup.status !== 0) {
    return null;
  }
  const resolvedPath = lookup.stdout.trim();
  return resolvedPath.length > 0 ? resolvedPath : null;
}

async function binaryMetadata(binaryPath, versionArgs) {
  const versionResult = runCommand(binaryPath, versionArgs);
  const binaryBytes = await readFile(binaryPath);
  return {
    path: binaryPath,
    sha256: sha256(binaryBytes),
    sizeBytes: (await stat(binaryPath)).size,
    versionOutput: versionResult.stdout.trim() || versionResult.stderr.trim()
  };
}

function renderWithLynx(binaryPath, htmlPath, width) {
  const result = runCommand(binaryPath, ["-dump", "-nolist", `-width=${String(width)}`, htmlPath]);
  return {
    ok: result.status === 0,
    output: result.stdout,
    error: result.status === 0 ? null : result.stderr.trim()
  };
}

function renderWithW3m(binaryPath, htmlInput, width) {
  const result = runCommand(
    binaryPath,
    ["-dump", "-cols", String(width), "-T", "text/html"],
    { input: htmlInput }
  );
  return {
    ok: result.status === 0,
    output: result.stdout,
    error: result.status === 0 ? null : result.stderr.trim()
  };
}

function renderWithLinks2(binaryPath, htmlPath, width) {
  const result = runCommand(binaryPath, ["-dump", "-width", String(width), "-codepage", "utf-8", htmlPath]);
  return {
    ok: result.status === 0,
    output: result.stdout,
    error: result.status === 0 ? null : result.stderr.trim()
  };
}

async function loadFixtures() {
  const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true });
  const ids = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const fixtures = [];
  for (const id of ids) {
    const htmlPath = resolve(FIXTURE_ROOT, id, "input.html");
    const html = await readFile(htmlPath, "utf8");
    const expected = visibleText(parse(html));
    fixtures.push({ id, htmlPath, html, expected });
  }
  return fixtures;
}

async function runEngineCompare(engineName, fixtures) {
  const binaryName = engineName === "links2" ? "links2" : engineName;
  const binaryPath = findBinary(binaryName);
  if (!binaryPath) {
    return {
      engine: engineName,
      available: false,
      missingBinary: binaryName,
      metadata: null,
      runs: [],
      meanTokenF1: 0
    };
  }

  const metadata = await binaryMetadata(binaryPath, ["-version"]);
  const runs = [];
  for (const fixture of fixtures) {
    for (const width of WIDTHS) {
      let runResult;
      if (engineName === "lynx") {
        runResult = renderWithLynx(binaryPath, fixture.htmlPath, width);
      } else if (engineName === "w3m") {
        runResult = renderWithW3m(binaryPath, fixture.html, width);
      } else {
        runResult = renderWithLinks2(binaryPath, fixture.htmlPath, width);
      }

      const similarity = runResult.ok ? tokenF1(fixture.expected, runResult.output) : 0;
      runs.push({
        fixtureId: fixture.id,
        width,
        ok: runResult.ok,
        similarityTokenF1: similarity,
        outputSha256: sha256(runResult.output),
        output: runResult.output,
        error: runResult.error
      });
    }
  }

  const successfulRuns = runs.filter((run) => run.ok);
  const meanTokenF1 = successfulRuns.length === 0
    ? 0
    : successfulRuns.reduce((sum, run) => sum + run.similarityTokenF1, 0) / successfulRuns.length;

  return {
    engine: engineName,
    available: true,
    metadata,
    runs,
    meanTokenF1
  };
}

async function main() {
  const fixtures = await loadFixtures();
  const engines = [];
  for (const engineName of ["lynx", "w3m", "links2"]) {
    engines.push(await runEngineCompare(engineName, fixtures));
  }

  await writeJson(OUTPUT_PATH, {
    suite: "visible-text-oracle-compare",
    timestamp: nowIso(),
    widths: WIDTHS,
    fixtures: {
      root: FIXTURE_ROOT,
      count: fixtures.length
    },
    engines
  });

  process.stdout.write(`visible text oracle compare report: ${OUTPUT_PATH}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
