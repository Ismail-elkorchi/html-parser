import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";

import {
  compareNpmProvenanceStatement,
  compareNpmVersionMetadata
} from "./registry-integrity.mjs";

const PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1";

function immutableResult(state, failures = []) {
  return Object.freeze({ state, failures: Object.freeze(failures) });
}

/** Resolves npm metadata while treating delayed attestation availability as transient. */
export async function resolveNpmVersionState(metadata, expected, fetchImpl = globalThis.fetch) {
  const metadataComparison = compareNpmVersionMetadata(metadata, expected);
  const permanentMetadataFailures = metadataComparison.failures.filter(
    (failure) => failure !== "provenance"
  );
  if (permanentMetadataFailures.length > 0) {
    return immutableResult("mismatch", permanentMetadataFailures);
  }

  const attestationsUrl = metadata?.dist?.attestations?.url;
  if (typeof attestationsUrl !== "string") {
    return immutableResult("pending", ["provenance-unavailable"]);
  }
  const response = await fetchImpl(attestationsUrl, {
    cache: "no-store",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" }
  });
  if (response.status === 404) {
    return immutableResult("pending", ["provenance-unavailable"]);
  }
  if (!response.ok) {
    throw new Error(`npm attestations returned HTTP ${response.status}`);
  }

  const attestations = await response.json();
  const provenance = attestations?.attestations?.find(
    (attestation) => attestation?.predicateType === PROVENANCE_PREDICATE
  );
  const encodedPayload = provenance?.bundle?.dsseEnvelope?.payload;
  if (typeof encodedPayload !== "string") {
    return immutableResult("pending", ["provenance-unavailable"]);
  }
  const statement = JSON.parse(Buffer.from(encodedPayload, "base64").toString("utf8"));
  const provenanceComparison = compareNpmProvenanceStatement(statement, expected);
  const failures = [
    ...metadataComparison.failures,
    ...provenanceComparison.failures.map((failure) => `provenance:${failure}`)
  ];
  return immutableResult(failures.length === 0 ? "identical" : "mismatch", failures);
}

/** Polls only transient absent/pending states and stops immediately on immutable evidence. */
export async function waitForRegistryState(readState, options) {
  const {
    waitMilliseconds,
    initialDelayMilliseconds = 5_000,
    maxDelayMilliseconds = 30_000,
    now = Date.now,
    sleep = delay
  } = options;
  const deadline = now() + waitMilliseconds;
  let result = await readState();
  let nextDelay = initialDelayMilliseconds;

  while (
    (result.state === "absent" || result.state === "pending") &&
    now() < deadline
  ) {
    const remaining = deadline - now();
    await sleep(Math.min(nextDelay, remaining));
    result = await readState();
    nextDelay = Math.min(nextDelay * 2, maxDelayMilliseconds);
  }
  return result;
}
