import { rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const outputDirectory = path.resolve("tmp/test-runtime");
const compiler = path.resolve("node_modules/typescript/bin/tsc");

rmSync(outputDirectory, { force: true, recursive: true });

const result = spawnSync(process.execPath, [compiler, "-p", "tsconfig.test-runtime.json"], {
  stdio: "inherit"
});

if (typeof result.status === "number") {
  process.exitCode = result.status;
} else {
  throw result.error ?? new Error("TypeScript runtime-test compilation did not exit cleanly");
}
