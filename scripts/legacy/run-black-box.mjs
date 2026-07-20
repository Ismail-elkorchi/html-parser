import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parse, parseBytes, parseFragment, parseStream } from "../../dist/mod.js";
import {
  parseBytesWithIndependentEngine,
  parseFragmentWithIndependentEngine,
  parseStreamWithIndependentEngine,
  parseWithIndependentEngine
} from "../../dist/integration/html-product-adapter.js";

const LEGACY_API = Object.freeze({ parse, parseBytes, parseFragment, parseStream });
const INDEPENDENT_API = Object.freeze({
  parse: parseWithIndependentEngine,
  parseBytes: parseBytesWithIndependentEngine,
  parseFragment: parseFragmentWithIndependentEngine,
  parseStream: parseStreamWithIndependentEngine
});

function canonicalizeError(error) {
  if (!(error instanceof Error)) {
    return canonicalize(error);
  }

  const result = {
    name: error.name,
    message: error.message
  };
  for (const key of Object.keys(error).sort()) {
    if (key !== "name" && key !== "message") {
      result[key] = canonicalize(error[key]);
    }
  }
  if ("cause" in error && !Object.hasOwn(result, "cause")) {
    result.cause = canonicalizeError(error.cause);
  }
  return canonicalize(result);
}

function canonicalize(value) {
  if (value instanceof Error) {
    return canonicalizeError(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value !== null && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child !== undefined) {
        result[key] = canonicalize(child);
      }
    }
    return result;
  }
  return value;
}

function decodeBase64(value) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function createFixtureStream(request) {
  let index = 0;
  return new globalThis.ReadableStream({
    pull(controller) {
      if (index < request.chunksBase64.length) {
        controller.enqueue(decodeBase64(request.chunksBase64[index]));
        index += 1;
        return;
      }
      if (request.failAfterChunks) {
        controller.error(new TypeError(request.failureMessage));
      } else {
        controller.close();
      }
    }
  });
}

async function executeRequest(request, api) {
  const options = { ...request.options };
  if (request.traceCallbackFailure) {
    let observed = 0;
    options.onTraceEvent = () => {
      observed += 1;
      if (observed === request.traceCallbackFailure.afterEvent) {
        throw new Error(request.traceCallbackFailure.message);
      }
    };
  }
  if (request.abortReason !== undefined) {
    const controller = new globalThis.AbortController();
    controller.abort(request.abortReason);
    options.signal = controller.signal;
  }

  switch (request.operation) {
    case "parse":
      return api.parse(request.input, options);
    case "parseBytes":
      return api.parseBytes(decodeBase64(request.inputBase64), options);
    case "parseFragment":
      return api.parseFragment(request.input, request.contextTagName, options);
    case "parseStream":
      return await api.parseStream(createFixtureStream(request), options);
    default:
      throw new Error(`Unknown black-box fixture operation: ${String(request.operation)}`);
  }
}

export async function runBlackBoxFixture(fixture, api) {
  if (fixture?.schemaVersion !== 1 || !Array.isArray(fixture.cases)) {
    throw new Error("Legacy black-box fixture must use schemaVersion 1 and contain cases");
  }

  const outputs = [];
  for (const request of fixture.cases) {
    try {
      outputs.push({
        id: request.id,
        status: "returned",
        value: canonicalize(await executeRequest(request, api))
      });
    } catch (error) {
      outputs.push({
        id: request.id,
        status: "threw",
        error: canonicalizeError(error)
      });
    }
  }

  return canonicalize({ schemaVersion: 1, cases: outputs });
}

export function runLegacyBlackBoxFixture(fixture) {
  return runBlackBoxFixture(fixture, LEGACY_API);
}

export function runIndependentBlackBoxFixture(fixture) {
  return runBlackBoxFixture(fixture, INDEPENDENT_API);
}

export function serializeCanonical(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

async function main() {
  const independent = process.argv.includes("--engine=independent");
  const fixturePath = process.argv.find((argument) => !argument.startsWith("--") && argument.endsWith(".json"));
  if (!fixturePath) {
    throw new Error("Usage: node scripts/legacy/run-black-box.mjs [--engine=independent] <fixture.json>");
  }
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const result = independent
    ? await runIndependentBlackBoxFixture(fixture)
    : await runLegacyBlackBoxFixture(fixture);
  process.stdout.write(serializeCanonical(result));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
