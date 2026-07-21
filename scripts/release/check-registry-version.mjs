import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";

import { parseLongOptions } from "../lib/cli.mjs";
import {
  buildExpectedJsrVersion,
  compareNpmProvenanceStatement,
  compareJsrVersionMetadata,
  compareNpmVersionMetadata
} from "./registry-integrity.mjs";

const options = parseLongOptions(process.argv.slice(2), {
  registry: { type: "string", required: true },
  "require-present": { type: "boolean", default: false }
}, "registry version check");
if (options.registry !== "npm" && options.registry !== "jsr") {
  throw new Error(`registry version check: unsupported registry ${options.registry}`);
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
const response = await globalThis.fetch(url, {
  cache: "no-store",
  headers: {
    Accept: "application/json",
    "Cache-Control": "no-cache"
  }
});
if (response.status === 404) {
  const result = { registry: options.registry, name, version, state: "absent", failures: [] };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (options["require-present"]) process.exitCode = 1;
} else {
  if (!response.ok) {
    throw new Error(`${options.registry} registry returned HTTP ${response.status}`);
  }
  const metadata = await response.json();
  let comparison;
  if (options.registry === "npm") {
    const metadataComparison = compareNpmVersionMetadata(metadata, {
      name,
      version,
      integrity: packageReport.tarball?.integrity
    });
    let provenanceStatement;
    const attestationsUrl = metadata?.dist?.attestations?.url;
    if (typeof attestationsUrl === "string") {
      const attestationsResponse = await globalThis.fetch(attestationsUrl, {
        cache: "no-store",
        headers: { Accept: "application/json", "Cache-Control": "no-cache" }
      });
      if (!attestationsResponse.ok) {
        throw new Error(`npm attestations returned HTTP ${attestationsResponse.status}`);
      }
      const attestations = await attestationsResponse.json();
      const provenance = attestations?.attestations?.find((attestation) =>
        attestation?.predicateType === "https://slsa.dev/provenance/v1"
      );
      const encodedPayload = provenance?.bundle?.dsseEnvelope?.payload;
      if (typeof encodedPayload === "string") {
        provenanceStatement = JSON.parse(Buffer.from(encodedPayload, "base64").toString("utf8"));
      }
    }
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
    const provenanceComparison = compareNpmProvenanceStatement(provenanceStatement, {
      name,
      version,
      sha512: Buffer.from(encodedDigest, "base64").toString("hex"),
      repository,
      commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    });
    const failures = [
      ...metadataComparison.failures,
      ...provenanceComparison.failures.map((failure) => `provenance:${failure}`)
    ];
    comparison = Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
  } else {
    comparison = compareJsrVersionMetadata(
      metadata,
      await buildExpectedJsrVersion(process.cwd(), jsrManifest)
    );
  }
  const result = {
    registry: options.registry,
    name,
    version,
    state: comparison.ok ? "identical" : "mismatch",
    failures: comparison.failures
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!comparison.ok) process.exitCode = 1;
}
