import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const WORK_DIRECTORY = resolve("tmp/packed-type-consumer");
let tarballPath;

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: "pipe"
  });
}

try {
  run("npm", ["run", "build"]);
  const packResult = JSON.parse(execFileSync("npm", ["pack", "--json"], { encoding: "utf8" }));
  const tarballName = packResult?.[0]?.filename;
  if (typeof tarballName !== "string") throw new Error("packed types: npm pack returned no filename");
  tarballPath = resolve(tarballName);

  await rm(WORK_DIRECTORY, { recursive: true, force: true });
  await mkdir(WORK_DIRECTORY, { recursive: true });
  await copyFile("test/contracts/consumers/npm/index.ts", `${WORK_DIRECTORY}/index.ts`);
  await copyFile("test/contracts/consumers/npm/tsconfig.json", `${WORK_DIRECTORY}/tsconfig.json`);
  await copyFile(tarballPath, `${WORK_DIRECTORY}/${basename(tarballPath)}`);
  await writeFile(
    `${WORK_DIRECTORY}/package.json`,
    `${JSON.stringify({ name: "html-parser-type-consumer", private: true, type: "module" }, null, 2)}\n`,
    "utf8"
  );

  run("npm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--omit=dev",
    `./${basename(tarballPath)}`
  ], { cwd: WORK_DIRECTORY });
  run(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], {
    cwd: WORK_DIRECTORY
  });
  const installedManifest = JSON.parse(await readFile(
    `${WORK_DIRECTORY}/node_modules/@ismail-elkorchi/html-parser/package.json`,
    "utf8"
  ));
  if (installedManifest.version !== "0.1.1") {
    throw new Error(`packed types: expected version 0.1.1, got ${String(installedManifest.version)}`);
  }
  process.stdout.write("packed types: strict npm consumer compiles from the production tarball\n");
} finally {
  if (tarballPath !== undefined) await rm(tarballPath, { force: true });
  await rm(WORK_DIRECTORY, { recursive: true, force: true });
}
