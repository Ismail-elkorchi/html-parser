import {
  createEngineResourceGuard,
  EngineConfigurationError,
  type EngineResourceGuardOptions,
  type EngineResourceUsage
} from "./resource-guard.js";
import { ENGINE_STANDARD_BASELINE } from "./standards.js";
import { HtmlTokenizer } from "./tokenizer/tokenizer.js";
import { HtmlTreeBuilder, type HtmlTreeBuilderState } from "./tree-builder.js";
import { HtmlTreeModel } from "./tree-model.js";

import type { EngineParseError } from "./diagnostics.js";
import type { EngineObserver } from "./observer.js";
import type { NonExecutingScriptingMode } from "./parser-state.js";

/** Document parser configuration supported by the independent engine. */
export interface HtmlEngineDocumentConfiguration {
  readonly kind: "document";
  readonly scriptingMode: NonExecutingScriptingMode;
}

export type HtmlEngineParserConfiguration = HtmlEngineDocumentConfiguration;

export interface HtmlEngineOptions extends EngineResourceGuardOptions {
  readonly inputChunks: readonly string[];
  readonly parser: HtmlEngineParserConfiguration;
  readonly observer?: EngineObserver;
}

export interface HtmlEngineResult {
  readonly standardBaseline: typeof ENGINE_STANDARD_BASELINE;
  readonly parser: HtmlEngineParserConfiguration;
  readonly model: HtmlTreeModel;
  readonly state: HtmlTreeBuilderState;
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

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInputChunks(inputChunks: unknown): readonly string[] {
  if (!Array.isArray(inputChunks)) {
    throw new EngineConfigurationError("options.inputChunks", "must be an array of strings");
  }
  const validated: string[] = [];
  for (const chunk of inputChunks) {
    if (typeof chunk !== "string") {
      throw new EngineConfigurationError("options.inputChunks", "must be an array of strings");
    }
    validated.push(chunk);
  }
  return Object.freeze(validated);
}

function validateParser(parser: unknown): HtmlEngineParserConfiguration {
  if (!isRecord(parser)) {
    throw new EngineConfigurationError("options.parser", "must be a document configuration");
  }
  const record = parser;
  assertAllowedKeys(record, new Set(["kind", "scriptingMode"]), "options.parser");
  if (record["kind"] !== "document") {
    throw new EngineConfigurationError("options.parser.kind", 'must be "document"');
  }
  if (record["scriptingMode"] !== "disabled" && record["scriptingMode"] !== "inert") {
    throw new EngineConfigurationError(
      "options.parser.scriptingMode",
      'must be "disabled" or "inert"'
    );
  }
  return Object.freeze({ kind: "document", scriptingMode: record["scriptingMode"] });
}

function validateObserver(observer: EngineObserver | undefined): EngineObserver | undefined {
  if (observer === undefined) return undefined;
  if (!isRecord(observer)) {
    throw new EngineConfigurationError("options.observer", "must be an object");
  }
  const record = observer;
  const callbackNames = new Set<PropertyKey>([
    "onToken",
    "onParseError",
    "onInsertionModeTransition",
    "onTreeMutation"
  ]);
  assertAllowedKeys(record, callbackNames, "options.observer");
  for (const name of callbackNames) {
    if (record[name] !== undefined && typeof record[name] !== "function") {
      throw new EngineConfigurationError(`options.observer.${String(name)}`, "must be a function");
    }
  }
  return observer;
}

/** Runs one isolated incremental independent-engine operation. */
export function runHtmlEngine(options: HtmlEngineOptions): HtmlEngineResult {
  const unknownOptions: unknown = options;
  if (!isRecord(unknownOptions)) {
    throw new EngineConfigurationError("options", "must be an object");
  }
  const record = unknownOptions;
  assertAllowedKeys(
    record,
    new Set(["inputChunks", "parser", "observer", "limits", "signal", "now", "startedAt"]),
    "options"
  );
  const inputChunks = validateInputChunks(record["inputChunks"]);
  const parser = validateParser(record["parser"]);
  const observer = validateObserver(options.observer);
  const resourceOptions: EngineResourceGuardOptions = {
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt })
  };
  const resources = createEngineResourceGuard(resourceOptions);
  const parseErrors: EngineParseError[] = [];
  const model = new HtmlTreeModel({
    rootKind: "document",
    resources,
    ...(observer === undefined ? {} : { observer })
  });
  const builder = new HtmlTreeBuilder({
    model,
    resources,
    scriptingMode: parser.scriptingMode,
    ...(observer === undefined ? {} : { observer }),
    onParseError(error) { parseErrors.push(error); }
  });
  const tokenizer = new HtmlTokenizer(resources, builder, {
    observer: {
      onToken(token) { observer?.onToken?.(token); },
      onParseError(error) {
        parseErrors.push(error);
        observer?.onParseError?.(error);
      }
    }
  });
  builder.connectTokenizer(tokenizer);
  for (const chunk of inputChunks) tokenizer.write(chunk);
  tokenizer.close();
  return Object.freeze({
    standardBaseline: ENGINE_STANDARD_BASELINE,
    parser,
    model,
    state: builder.state(),
    parseErrors: Object.freeze(parseErrors),
    resources: resources.snapshot()
  });
}
