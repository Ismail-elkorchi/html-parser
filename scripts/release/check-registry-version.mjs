import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import process from "node:process";

import { parseLongOptions } from "../lib/cli.mjs";
import {
  buildExpectedJsrVersion,
  compareJsrVersionMetadata
} from "./registry-integrity.mjs";
import {
  resolveNpmVersionState,
  resolveVersionTagCommit,
  waitForRegistryState
} from "./registry-state.mjs";

const options = parseLongOptions(process.argv.slice(2), {
  registry: { type: "string", required: true },
  "require-present": { type: "boolean", default: false },
  "wait-seconds": { type: "string", default: "0" }
}, "registry version check");
if (options.registry !== "npm" && options.registry !== "jsr") {
  throw new Error(`registry version check: unsupported registry ${options.registry}`);
}
if (!/^(?:0|[1-9][0-9]*)$/u.test(options["wait-seconds"])) {
  throw new Error("registry version check: --wait-seconds must be a non-negative integer");
}
const waitSeconds = Number(options["wait-seconds"]);
if (!Number.isSafeInteger(waitSeconds) || waitSeconds > 600) {
  throw new Error("registry version check: --wait-seconds must not exceed 600");
}
if (waitSeconds > 0 && !options["require-present"]) {
  throw new Error("registry version check: --wait-seconds requires --require-present");
}

const [packageManifest, jsrManifest, packageReport] = await Promise.all([
  readFile("package.json", "utf8").then(JSON.parse),
  readFile("jsr.json", "utf8").then(JSON.parse),
  readFile("reports/package.json", "utf8").then(JSON.parse)
]);
const name = packageManifest.name;
const version = packageManifest.version;
if (
  typeof name !== "string" ||
  typeof version !== "string" ||
  jsrManifest.name !== name ||
  jsrManifest.version !== version ||
  packageReport.ok !== true ||
  packageReport.package?.name !== name ||
  packageReport.package?.version !== version
) {
  throw new Error("registry version check requires matching qualified manifests");
}

const url = options.registry === "npm"
  ? `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`
  : `https://jsr.io/${name}/${version}_meta.json`;
const integrity = packageReport.tarball?.integrity;
const [algorithm, encodedDigest] = typeof integrity === "string"
  ? integrity.split("-", 2)
  : [];
if (algorithm !== "sha512" || encodedDigest === undefined) {
  throw new Error("qualified npm artifact is missing SHA-512 integrity");
}
const repository = String(packageManifest.repository?.url ?? "")
  .replace(/^git\+/u, "")
  .replace(/\.git$/u, "");
const npmExpected = {
  name,
  version,
  integrity,
  sha512: Buffer.from(encodedDigest, "base64").toString("hex"),
  repository
};
const jsrExpected = options.registry === "jsr"
  ? await buildExpectedJsrVersion(process.cwd(), jsrManifest)
  : undefined;

async function readState() {
  const response = await globalThis.fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache"
    }
  });
  if (response.status === 404) {
    return Object.freeze({ state: "absent", failures: Object.freeze([]) });
  }
  if (!response.ok) {
    throw new Error(`${options.registry} registry returned HTTP ${response.status}`);
  }
  const metadata = await response.json();
  if (options.registry === "npm") {
    return resolveNpmVersionState(metadata, {
      ...npmExpected,
      commit: resolveVersionTagCommit(version)
    });
  }
  const comparison = compareJsrVersionMetadata(metadata, jsrExpected);
  return Object.freeze({
    state: comparison.ok ? "identical" : "mismatch",
    failures: comparison.failures
  });
}

const comparison = await waitForRegistryState(readState, {
  waitMilliseconds: waitSeconds * 1_000
});
const result = { registry: options.registry, name, version, ...comparison };
process.stdout.write(`${JSON.stringify(result)}\n`);
if (
  comparison.state === "mismatch" ||
  comparison.state === "pending" ||
  (comparison.state === "absent" && options["require-present"])
) {
  process.exitCode = 1;
}
