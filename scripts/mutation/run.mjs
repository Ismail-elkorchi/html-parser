import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { parseLongOptions } from "../lib/cli.mjs";

function runCommand(command, cwd) {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function applySingleReplace(source, search, replace) {
  const firstIndex = source.indexOf(search);
  if (firstIndex === -1) {
    return { ok: false, value: source, reason: "search-not-found" };
  }

  const secondIndex = source.indexOf(search, firstIndex + search.length);
  if (secondIndex !== -1) {
    return { ok: false, value: source, reason: "search-not-unique" };
  }

  return {
    ok: true,
    value: `${source.slice(0, firstIndex)}${replace}${source.slice(firstIndex + search.length)}`,
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const WORKSPACE_ENTRIES = Object.freeze([
  "dist",
  "scripts",
  "test",
  "tmp/test-runtime",
]);

function validateConfig(config, repoRoot) {
  if (!isRecord(config) || !Array.isArray(config.targets) || config.targets.length === 0) {
    throw new Error("mutation config must define a non-empty targets array");
  }
  const targetFiles = new Set();
  const mutantIds = new Set();
  for (const target of config.targets) {
    if (!isRecord(target) || typeof target.targetFile !== "string" ||
        !Array.isArray(target.testCommand) || target.testCommand.length === 0 ||
        !target.testCommand.every((part) => typeof part === "string" && part.length > 0) ||
        !Array.isArray(target.mutants) || target.mutants.length === 0) {
      throw new Error("each mutation target needs a file, command, and non-empty mutant inventory");
    }
    const targetPath = path.resolve(repoRoot, target.targetFile);
    const relativeTarget = path.relative(repoRoot, targetPath).split(path.sep).join("/");
    if (relativeTarget.startsWith("../") || path.isAbsolute(relativeTarget)) {
      throw new Error(`mutation target must stay inside the repository: ${target.targetFile}`);
    }
    if (!fs.statSync(targetPath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`mutation target does not exist: ${target.targetFile}`);
    }
    if (targetFiles.has(relativeTarget)) throw new Error(`duplicate mutation target: ${relativeTarget}`);
    targetFiles.add(relativeTarget);
    for (const mutant of target.mutants) {
      if (!isRecord(mutant) || typeof mutant.id !== "string" || mutant.id.length === 0 ||
          typeof mutant.description !== "string" || mutant.description.length === 0 ||
          typeof mutant.search !== "string" || mutant.search.length === 0 ||
          typeof mutant.replace !== "string") {
        throw new Error(`invalid mutant in ${relativeTarget}`);
      }
      if (mutantIds.has(mutant.id)) throw new Error(`duplicate mutant id: ${mutant.id}`);
      mutantIds.add(mutant.id);
    }
  }
}

function createWorkspace(repoRoot) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "html-parser-mutation-"));
  try {
    for (const entry of WORKSPACE_ENTRIES) {
      const source = path.join(repoRoot, entry);
      const destination = path.join(workspaceRoot, entry);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(source, destination, { recursive: true });
    }
    fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(workspaceRoot, "node_modules"), "dir");
    return workspaceRoot;
  } catch (error) {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
}

function main() {
  const args = parseLongOptions(process.argv.slice(2), {
    config: { type: "string", default: "scripts/mutation/config.json" },
    out: { type: "string", default: "reports/mutation.json" }
  }, "mutation qualification");
  const repoRoot = process.cwd();
  const configPath = path.resolve(repoRoot, args.config);
  const outPath = path.resolve(repoRoot, args.out);

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  validateConfig(config, repoRoot);
  const workspaceRoot = createWorkspace(repoRoot);

  const report = {
    schemaVersion: 1,
    suite: "html-parser-mutation",
    generatedAt: new Date().toISOString(),
    config: path.relative(repoRoot, configPath).split(path.sep).join("/"),
    targets: [],
    totals: {
      total: 0,
      killed: 0,
      survived: 0,
      invalid: 0,
    },
  };

  try {
    for (const target of config.targets) {
      const targetPath = path.resolve(workspaceRoot, target.targetFile);
      const originalSource = fs.readFileSync(targetPath, "utf8");
      const targetReport = {
        targetFile: target.targetFile,
        testCommand: target.testCommand,
        mutants: [],
      };
      report.targets.push(targetReport);

      for (const mutant of target.mutants) {
        report.totals.total += 1;
        const applied = applySingleReplace(originalSource, mutant.search, mutant.replace);
        if (!applied.ok) {
          report.totals.invalid += 1;
          targetReport.mutants.push({
            id: mutant.id,
            description: mutant.description,
            status: "invalid",
            reason: applied.reason,
          });
          continue;
        }

        fs.writeFileSync(targetPath, applied.value, "utf8");
        const execution = runCommand(target.testCommand, workspaceRoot);
        const status = execution.status === 0 ? "survived" : "killed";
        if (status === "survived") {
          report.totals.survived += 1;
        } else {
          report.totals.killed += 1;
        }

        targetReport.mutants.push({
          id: mutant.id,
          description: mutant.description,
          status,
          testExitCode: execution.status,
        });
      }
      fs.writeFileSync(targetPath, originalSource, "utf8");
    }
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(
    `mutation qualification: total=${report.totals.total} killed=${report.totals.killed} ` +
      `survived=${report.totals.survived} invalid=${report.totals.invalid}\n`,
  );
  if (report.totals.survived > 0 || report.totals.invalid > 0 ||
      report.totals.killed !== report.totals.total) {
    process.exitCode = 1;
  }
}

main();
