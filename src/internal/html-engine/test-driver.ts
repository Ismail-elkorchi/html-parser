import { failInternalState } from "../foundation/internal-state-error.js";

import { HtmlInputCursor, type InputCharacter } from "./input-cursor.js";
import {
  createEngineResourceGuard,
  EngineConfigurationError,
  type EngineResourceGuardOptions,
  type EngineResourceUsage
} from "./resource-guard.js";
import { ENGINE_STANDARD_BASELINE } from "./standards.js";

import type { EngineParseError } from "./diagnostics.js";
import type { EngineObserver } from "./observer.js";
import type { NonExecutingScriptingMode } from "./parser-state.js";
import type { HtmlToken } from "./tokens.js";

/** Document-mode configuration for the non-executing foundation driver. */
export interface EngineDocumentDriverConfiguration {
  readonly kind: "document";
  readonly scriptingMode: NonExecutingScriptingMode;
}

/** Exact fragment context used by the non-executing foundation driver. */
export interface EngineFragmentContext {
  readonly namespaceUri: string;
  readonly localName: string;
}

/** Fragment-mode configuration for the non-executing foundation driver. */
export interface EngineFragmentDriverConfiguration {
  readonly kind: "fragment";
  readonly context: EngineFragmentContext;
  readonly scriptingMode: NonExecutingScriptingMode;
}

export type EngineDriverParserConfiguration =
  | EngineDocumentDriverConfiguration
  | EngineFragmentDriverConfiguration;

/** Inputs accepted only by the internal foundation test driver. */
export interface EngineFoundationDriverOptions extends EngineResourceGuardOptions {
  readonly inputChunks: readonly string[];
  readonly parser: EngineDriverParserConfiguration;
  readonly observer?: EngineObserver;
}

/** Explicit non-result returned while parsing algorithms are not implemented. */
export interface EngineFoundationDriverResult {
  readonly status: "not-implemented";
  readonly standardBaseline: typeof ENGINE_STANDARD_BASELINE;
  readonly parser: EngineDriverParserConfiguration;
  readonly input: string;
  readonly inputCharacters: readonly InputCharacter[];
  readonly tokens: readonly HtmlToken[];
  readonly parseErrors: readonly EngineParseError[];
  readonly resources: EngineResourceUsage;
}

function assertAllowedKeys(
  value: Readonly<Record<PropertyKey, unknown>>,
  allowed: ReadonlySet<PropertyKey>,
  option: string
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (!allowed.has(key)) {
      throw new EngineConfigurationError(`${option}.${String(key)}`, "is not supported");
    }
  }
}

function validateParser(
  parser: EngineDriverParserConfiguration
): EngineDriverParserConfiguration {
  const unknownParser: unknown = parser;
  if (typeof unknownParser !== "object" || unknownParser === null || Array.isArray(unknownParser)) {
    throw new EngineConfigurationError("parser", "must be a document or fragment configuration");
  }
  const record = unknownParser as Readonly<Record<string, unknown>>;
  assertAllowedKeys(
    record,
    new Set(record["kind"] === "fragment" ? ["kind", "context", "scriptingMode"] : ["kind", "scriptingMode"]),
    "parser"
  );
  if (record["scriptingMode"] !== "disabled" && record["scriptingMode"] !== "inert") {
    throw new EngineConfigurationError(
      "parser.scriptingMode",
      'must be "disabled" or "inert" in the non-executing driver'
    );
  }
  if (record["kind"] === "document") {
    return Object.freeze({ kind: "document", scriptingMode: record["scriptingMode"] });
  }
  if (record["kind"] !== "fragment") {
    throw new EngineConfigurationError("parser.kind", 'must be "document" or "fragment"');
  }
  const context = record["context"];
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw new EngineConfigurationError("parser.context", "must provide namespaceUri and localName");
  }
  const contextRecord = context as Readonly<Record<string, unknown>>;
  assertAllowedKeys(contextRecord, new Set(["namespaceUri", "localName"]), "parser.context");
  if (typeof contextRecord["namespaceUri"] !== "string" || contextRecord["namespaceUri"].length === 0) {
    throw new EngineConfigurationError("parser.context.namespaceUri", "must be a non-empty string");
  }
  if (typeof contextRecord["localName"] !== "string" || contextRecord["localName"].length === 0) {
    throw new EngineConfigurationError("parser.context.localName", "must be a non-empty string");
  }
  return Object.freeze({
    kind: "fragment",
    context: Object.freeze({
      namespaceUri: contextRecord["namespaceUri"],
      localName: contextRecord["localName"]
    }),
    scriptingMode: record["scriptingMode"]
  });
}

function validateInputChunks(inputChunks: readonly string[]): readonly string[] {
  const unknownInputChunks: unknown = inputChunks;
  if (!isUnknownArray(unknownInputChunks)) {
    throw new EngineConfigurationError("inputChunks", "must be an array of strings");
  }
  const validated: string[] = [];
  for (const chunk of unknownInputChunks) {
    if (typeof chunk !== "string") {
      throw new EngineConfigurationError("inputChunks", "must be an array of strings");
    }
    validated.push(chunk);
  }
  return Object.freeze(validated);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** Runs input preprocessing only and never invokes the production legacy parser. */
export function runEngineFoundationDriver(
  options: EngineFoundationDriverOptions
): EngineFoundationDriverResult {
  const unknownOptions: unknown = options;
  if (typeof unknownOptions !== "object" || unknownOptions === null || Array.isArray(unknownOptions)) {
    throw new EngineConfigurationError("options", "must be an object");
  }
  assertAllowedKeys(
    unknownOptions as Readonly<Record<PropertyKey, unknown>>,
    new Set(["inputChunks", "parser", "observer", "limits", "signal", "now", "startedAt"]),
    "options"
  );
  const inputChunks = validateInputChunks(options.inputChunks);
  const parser = validateParser(options.parser);
  const unknownObserver: unknown = options.observer;
  if (unknownObserver !== undefined) {
    if (typeof unknownObserver !== "object" || unknownObserver === null || Array.isArray(unknownObserver)) {
      throw new EngineConfigurationError("options.observer", "must be an object");
    }
    const observerRecord = unknownObserver as Readonly<Record<PropertyKey, unknown>>;
    const observerKeys = new Set<PropertyKey>([
      "onToken",
      "onParseError",
      "onInsertionModeTransition",
      "onTreeMutation"
    ]);
    assertAllowedKeys(observerRecord, observerKeys, "options.observer");
    for (const key of observerKeys) {
      const callback = observerRecord[key];
      if (callback !== undefined && typeof callback !== "function") {
        throw new EngineConfigurationError(`options.observer.${String(key)}`, "must be a function");
      }
    }
  }
  const guard = createEngineResourceGuard({
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt })
  });
  const inputCharacters: InputCharacter[] = [];
  const parseErrors: EngineParseError[] = [];
  const cursor = new HtmlInputCursor(guard, (error) => {
    parseErrors.push(error);
    options.observer?.onParseError?.(error);
  });

  function consumeAvailable(): boolean {
    for (;;) {
      const read = cursor.consume();
      if (read.kind === "character") {
        inputCharacters.push(read);
        continue;
      }
      return read.kind === "eof";
    }
  }

  for (const chunk of inputChunks) {
    cursor.write(chunk);
    consumeAvailable();
  }
  cursor.close();
  if (!consumeAvailable()) {
    failInternalState("FOUNDATION_CURSOR_REQUESTED_MORE_AFTER_CLOSE");
  }

  return Object.freeze({
    status: "not-implemented",
    standardBaseline: ENGINE_STANDARD_BASELINE,
    parser,
    input: inputChunks.join(""),
    inputCharacters: Object.freeze(inputCharacters),
    tokens: Object.freeze([]),
    parseErrors: Object.freeze(parseErrors),
    resources: guard.snapshot()
  });
}
