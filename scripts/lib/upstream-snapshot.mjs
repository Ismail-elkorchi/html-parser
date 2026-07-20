import { execFileSync } from "node:child_process";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Returns exact additions and removals between a reviewed and observed inventory. */
export function inventoryDifference(reviewedPaths, observedPaths) {
  const reviewed = new Set(reviewedPaths);
  const observed = new Set(observedPaths);
  if (reviewed.size !== reviewedPaths.length || observed.size !== observedPaths.length) {
    throw new Error("fixture inventories must not contain duplicate paths");
  }
  return Object.freeze({
    added: Object.freeze(observedPaths.filter((filePath) => !reviewed.has(filePath)).sort(comparePaths)),
    removed: Object.freeze(reviewedPaths.filter((filePath) => !observed.has(filePath)).sort(comparePaths))
  });
}

export function assertCommit(value, label = "commit") {
  if (!/^[a-f0-9]{40}$/.test(value ?? "")) {
    throw new Error(`${label} must be a full lowercase 40-character Git object ID`);
  }
  return value;
}

export function git(repositoryRoot, args) {
  return execFileSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  }).trim();
}

/** Acquires one exact sparse Git revision or validates a supplied checkout. */
export async function acquirePinnedGitSource({
  repository,
  commit,
  source,
  sparsePaths,
  temporaryPrefix
}) {
  assertCommit(commit);
  if (source !== undefined) {
    const sourceRoot = path.resolve(source);
    const actualCommit = git(sourceRoot, ["rev-parse", "HEAD^{commit}"]);
    if (actualCommit !== commit) {
      throw new Error(`--source is at ${actualCommit}; expected ${commit}`);
    }
    return Object.freeze({ sourceRoot, cleanup: async () => {} });
  }

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), temporaryPrefix));
  try {
    execFileSync("git", ["init", "--quiet", temporaryRoot], { stdio: "inherit" });
    git(temporaryRoot, ["remote", "add", "origin", repository]);
    git(temporaryRoot, ["config", "core.sparseCheckout", "true"]);
    await writeFile(
      path.join(temporaryRoot, ".git", "info", "sparse-checkout"),
      `${sparsePaths.map((entry) => `/${entry.replace(/^\/+/, "")}`).join("\n")}\n`,
      "utf8"
    );
    git(temporaryRoot, ["fetch", "--depth=1", "--filter=blob:none", "origin", commit]);
    git(temporaryRoot, ["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
    const actualCommit = git(temporaryRoot, ["rev-parse", "HEAD^{commit}"]);
    if (actualCommit !== commit) throw new Error(`fetched ${actualCommit}; expected ${commit}`);
    return Object.freeze({
      sourceRoot: temporaryRoot,
      cleanup: () => rm(temporaryRoot, { recursive: true, force: true })
    });
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Replaces files or directories as one transaction. Every destination is
 * restored if any rename fails.
 */
export async function replacePathsAtomically(replacements) {
  const transaction = `${String(process.pid)}-${Date.now().toString(36)}`;
  const states = replacements.map(({ source, destination }) => ({
    source,
    destination,
    backup: `${destination}.previous-${transaction}`,
    hadDestination: false,
    installed: false
  }));

  try {
    for (const state of states) {
      await rm(state.backup, { recursive: true, force: true });
      try {
        await rename(state.destination, state.backup);
        state.hadDestination = true;
      } catch (error) {
        if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
      }
    }
    for (const state of states) {
      await rename(state.source, state.destination);
      state.installed = true;
    }
  } catch (error) {
    for (const state of [...states].reverse()) {
      if (state.installed) await rm(state.destination, { recursive: true, force: true });
      if (state.hadDestination) await rename(state.backup, state.destination);
    }
    throw error;
  }

  await Promise.all(states.map((state) =>
    rm(state.backup, { recursive: true, force: true })
  ));
}
