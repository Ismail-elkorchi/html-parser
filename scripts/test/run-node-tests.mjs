import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const roots = process.argv.slice(2);

if (roots.length === 0) {
  throw new Error("run-node-tests: provide at least one test directory");
}

const files = [];
const unexpectedFiles = [];

for (const root of roots) {
  walk(resolve(process.cwd(), root));
}

if (files.length === 0) {
  throw new Error(`run-node-tests: no test files found under ${roots.join(", ")}`);
}
if (unexpectedFiles.length > 0) {
  throw new Error(
    `run-node-tests: test directories contain files without the .test.js suffix: ` +
      unexpectedFiles.sort().join(", ")
  );
}

files.sort();
const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit"
});

if (typeof result.status === "number") {
  process.exitCode = result.status;
} else {
  throw result.error ?? new Error("run-node-tests: node --test did not exit cleanly");
}

function walk(directoryPath) {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const absolutePath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    if (entry.isFile()) {
      if (entry.name.endsWith(".test.js")) files.push(absolutePath);
      else unexpectedFiles.push(absolutePath);
    }
  }
}
