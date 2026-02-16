import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { nowIso, writeJson } from "./eval-primitives.mjs";

const RUNTIME_SELF_CONTAINED_WORK_DIR = "tmp/runtime-self-contained";

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        command,
        args,
        cwd: options.cwd ?? process.cwd(),
        code: Number(code),
        stdout,
        stderr
      });
    });
  });
}

function summarizeStepResult(stepName, result) {
  return {
    step: stepName,
    command: `${result.command} ${result.args.join(" ")}`.trim(),
    cwd: result.cwd,
    code: result.code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function createRuntimeSmokeScript(packageName) {
  return `import { parse, parseBytes, parseFragment, parseStream, serialize } from "${packageName}";

const tree = parse("<p>ok</p>");
if (serialize(tree).length === 0) {
  throw new Error("serialize returned empty output");
}

const bytesTree = parseBytes(new Uint8Array([0x3c, 0x70, 0x3e, 0x78, 0x3c, 0x2f, 0x70, 0x3e]));
if (bytesTree.kind !== "document") {
  throw new Error("parseBytes did not return a document tree");
}

const fragment = parseFragment("ok", "section");
if (fragment.kind !== "fragment") {
  throw new Error("parseFragment did not return a fragment tree");
}

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array([0x3c, 0x70, 0x3e, 0x79, 0x3c, 0x2f, 0x70, 0x3e]));
    controller.close();
  }
});

const streamed = await parseStream(stream);
if (streamed.kind !== "document") {
  throw new Error("parseStream did not return a document tree");
}

console.log("runtime-self-contained ok");
`;
}

async function main() {
  const diagnostics = [];
  let checkPassed = false;
  let tarballName = null;

  try {
    const packageMeta = JSON.parse(await readFile("package.json", "utf8"));
    const packageName = String(packageMeta.name || "");
    if (packageName.length === 0) {
      throw new Error("package.json missing name");
    }

    const buildResult = await runCommand("npm", ["run", "build"]);
    diagnostics.push(summarizeStepResult("build", buildResult));
    if (buildResult.code !== 0) {
      throw new Error("build failed");
    }

    const packResult = await runCommand("npm", ["pack", "--silent"]);
    diagnostics.push(summarizeStepResult("pack", packResult));
    if (packResult.code !== 0) {
      throw new Error("npm pack failed");
    }

    const packedLines = packResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    tarballName = packedLines[packedLines.length - 1] ?? null;
    if (!tarballName) {
      throw new Error("npm pack did not produce a tarball filename");
    }

    await rm(RUNTIME_SELF_CONTAINED_WORK_DIR, { recursive: true, force: true });
    await mkdir(RUNTIME_SELF_CONTAINED_WORK_DIR, { recursive: true });

    const tarballSource = path.join(process.cwd(), tarballName);
    const tarballTarget = path.join(process.cwd(), RUNTIME_SELF_CONTAINED_WORK_DIR, tarballName);
    await copyFile(tarballSource, tarballTarget);

    await writeFile(
      path.join(RUNTIME_SELF_CONTAINED_WORK_DIR, "package.json"),
      `${JSON.stringify({ name: "runtime-self-contained-check", private: true, type: "module" }, null, 2)}\n`,
      "utf8"
    );

    const installResult = await runCommand("npm", ["install", "--omit=dev", `./${tarballName}`], {
      cwd: RUNTIME_SELF_CONTAINED_WORK_DIR
    });
    diagnostics.push(summarizeStepResult("install", installResult));
    if (installResult.code !== 0) {
      throw new Error("production-only install failed");
    }

    await writeFile(path.join(RUNTIME_SELF_CONTAINED_WORK_DIR, "smoke.mjs"), createRuntimeSmokeScript(packageName), "utf8");

    const smokeResult = await runCommand(process.execPath, ["smoke.mjs"], {
      cwd: RUNTIME_SELF_CONTAINED_WORK_DIR
    });
    diagnostics.push(summarizeStepResult("runtime-smoke", smokeResult));
    if (smokeResult.code !== 0) {
      throw new Error("runtime smoke execution failed");
    }

    const smokeOutput = smokeResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (!smokeOutput.includes("runtime-self-contained ok")) {
      throw new Error("runtime smoke did not print success marker");
    }

    checkPassed = true;
  } catch (error) {
    diagnostics.push({
      step: "failure",
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    if (tarballName) {
      await rm(path.join(process.cwd(), tarballName), { force: true });
    }
  }

  await writeJson("reports/runtime-self-contained.json", {
    suite: "runtime-self-contained",
    timestamp: nowIso(),
    ok: checkPassed,
    tarball: tarballName,
    nodeVersion: process.version,
    diagnostics
  });

  if (!checkPassed) {
    console.error("Runtime self-contained check failed. See reports/runtime-self-contained.json");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
