import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.join("src", "internal", "vendor");
const targetRoot = path.join("dist", "internal", "vendor");
const runtimeDirectories = ["parse5", "entities"];

await mkdir(targetRoot, { recursive: true });

for (const name of runtimeDirectories) {
  const sourceDir = path.join(sourceRoot, name);
  const targetDir = path.join(targetRoot, name);

  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
}

await rm(path.join(targetRoot, "parse5-runtime.ts"), { force: true });
