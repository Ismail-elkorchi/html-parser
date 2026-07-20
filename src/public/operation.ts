import {
  HtmlAbortError,
  HtmlBudgetExceededError,
  HtmlConfigurationError
} from "./errors.ts";

import type {
  ParseBudgetOptions,
  ChunkOptions,
  OperationOptions,
  ParseBytesOptions,
  ParseFragmentOptions,
  ParseOptions,
  ParseStreamBudgetOptions,
  ParseStreamOptions,
  SerializeOptions,
  TextContentExtractionOptions,
  TextExtractionOptions,
  TokenizeByteStreamEagerBudgetOptions,
  TokenizeByteStreamEagerOptions
} from "./types.ts";

const PARSE_BUDGET_KEYS = Object.freeze([
  "maxInputBytes",
  "maxDecodedUtf8Bytes",
  "maxNodes",
  "maxDepth",
  "maxParseErrors",
  "maxAttributesPerElement",
  "maxAttributeBytes",
  "maxTraceEvents",
  "maxTraceBytes",
  "maxTimeMs"
] as const satisfies readonly (keyof ParseBudgetOptions)[]);
const PARSE_STREAM_BUDGET_KEYS = Object.freeze([
  ...PARSE_BUDGET_KEYS,
  "maxEncodingPrescanBytes"
] as const satisfies readonly (keyof ParseStreamBudgetOptions)[]);
const TOKENIZE_BYTE_STREAM_EAGER_BUDGET_KEYS = Object.freeze([
  "maxInputBytes",
  "maxEncodingPrescanBytes",
  "maxDecodedUtf8Bytes",
  "maxParseErrors",
  "maxAttributesPerElement",
  "maxAttributeBytes",
  "maxTimeMs"
] as const satisfies readonly (keyof TokenizeByteStreamEagerBudgetOptions)[]);

const PARSE_COMMON_OPTION_KEYS = [
  "captureSpans",
  "trace",
  "onTraceEvent",
  "budgets",
  "signal"
] as const;
const PARSE_OPTION_KEYS = new Set<PropertyKey>([
  ...PARSE_COMMON_OPTION_KEYS,
  "sourceRetention"
]);
const PARSE_BYTES_OPTION_KEYS = new Set<PropertyKey>([
  ...PARSE_COMMON_OPTION_KEYS,
  "sourceRetention",
  "transportEncodingLabel"
]);
const PARSE_FRAGMENT_OPTION_KEYS = new Set<PropertyKey>(PARSE_COMMON_OPTION_KEYS);
const TOKENIZE_BYTE_STREAM_EAGER_OPTION_KEYS = new Set<PropertyKey>([
  "transportEncodingLabel",
  "budgets",
  "signal"
]);
const OPERATION_OPTION_KEYS = new Set<PropertyKey>(["maxTimeMs", "signal"]);
const SERIALIZE_OPTION_KEYS = new Set<PropertyKey>([
  ...OPERATION_OPTION_KEYS,
  "scriptingMode"
]);
const TEXT_EXTRACTION_OPTION_KEYS = [
  "policy",
  "maxOutputBytes",
  "maxTokens",
  ...OPERATION_OPTION_KEYS
] as const;
const VISIBLE_TEXT_EXTRACTION_OPTION_KEYS = new Set<PropertyKey>([
  ...TEXT_EXTRACTION_OPTION_KEYS,
  "maxFallbackInputBytes",
  "maxFallbackNodes",
  "skipHiddenSubtrees",
  "includeControlValues",
  "includeAccessibleNameFallback",
  "trim"
]);
const TEXT_CONTENT_EXTRACTION_OPTION_KEYS = new Set<PropertyKey>(TEXT_EXTRACTION_OPTION_KEYS);
const CHUNK_OPTION_KEYS = new Set<PropertyKey>([
  "maxChars",
  "maxNodes",
  "maxBytes",
  ...OPERATION_OPTION_KEYS
]);

type UnknownRecord = Readonly<Record<PropertyKey, unknown>>;

function invalidConfiguration(option: string, expected: string): never {
  throw new HtmlConfigurationError(option, "INVALID_VALUE", expected);
}

function asClosedRecord(value: unknown, option: string, allowedKeys: ReadonlySet<PropertyKey>): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidConfiguration(option, "must be a plain option object");
  }

  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    invalidConfiguration(option, "must expose readable own option keys");
  }

  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      throw new HtmlConfigurationError(
        `${option}.${String(key)}`,
        "UNKNOWN_OPTION",
        `must be one of ${[...allowedKeys].map(String).join(", ")}`
      );
    }
  }
  return value as UnknownRecord;
}

function read(record: UnknownRecord, key: PropertyKey, option: string): unknown {
  try {
    return record[key];
  } catch {
    invalidConfiguration(option, "must be a readable data property");
  }
}

function optionalBoolean(value: unknown, option: string): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    invalidConfiguration(option, "must be a boolean when provided");
  }
  return value;
}

function optionalString(value: unknown, option: string): string | undefined {
  if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
    invalidConfiguration(option, "must be a non-empty string when provided");
  }
  return value;
}

function isCallable(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function";
}

function optionalFunction(value: unknown, option: string): ((...args: never[]) => unknown) | undefined {
  if (value !== undefined && !isCallable(value)) {
    invalidConfiguration(option, "must be a function when provided");
  }
  return value;
}

function traceMode(value: unknown, option: string): ParseOptions["trace"] {
  if (value !== undefined && value !== "none" && value !== "summary" && value !== "events") {
    invalidConfiguration(option, 'must be "none", "summary", or "events" when provided');
  }
  return value;
}

function textExtractionPolicy(value: unknown, option: string): TextExtractionOptions["policy"] {
  if (value !== "visible-text-html-v1" && value !== "text-content-v1") {
    invalidConfiguration(option, 'must be "visible-text-html-v1" or "text-content-v1"');
  }
  return value;
}

function sourceRetention(value: unknown, option: string): ParseOptions["sourceRetention"] {
  if (value !== undefined && value !== "none" && value !== "text") {
    invalidConfiguration(option, 'must be "none" or "text" when provided');
  }
  return value;
}

function limit(value: unknown, option: string): number | undefined {
  if (
    value !== undefined &&
    (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0)
  ) {
    invalidConfiguration(option, "must be a finite, non-negative safe integer when provided");
  }
  return value;
}

function requiredLimit(value: unknown, option: string): number {
  const normalized = limit(value, option);
  if (normalized === undefined) {
    invalidConfiguration(option, "must be provided as a finite, non-negative safe integer");
  }
  return normalized;
}

function signal(value: unknown, option: string): AbortSignal | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    invalidConfiguration(option, "must be an AbortSignal when provided");
  }
  const signal = value as UnknownRecord;
  if (
    typeof read(signal, "aborted", `${option}.aborted`) !== "boolean" ||
    typeof read(signal, "addEventListener", `${option}.addEventListener`) !== "function" ||
    typeof read(signal, "removeEventListener", `${option}.removeEventListener`) !== "function"
  ) {
    invalidConfiguration(option, "must be an AbortSignal when provided");
  }
  return value as unknown as AbortSignal;
}

function normalizeBudgets(
  value: unknown,
  keys: readonly string[] = PARSE_BUDGET_KEYS
): Readonly<Record<string, number>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const budgets = asClosedRecord(value, "options.budgets", new Set<PropertyKey>(keys));
  const normalized: Record<string, number> = {};
  for (const key of keys) {
    const normalizedLimit = limit(
      read(budgets, key, `options.budgets.${key}`),
      `options.budgets.${key}`
    );
    if (normalizedLimit !== undefined) {
      normalized[key] = normalizedLimit;
    }
  }
  return Object.freeze(normalized);
}

function normalizeCommonOperationOptions(
  options: unknown,
  allowedKeys: ReadonlySet<PropertyKey>,
  optionName: string
): { readonly record: UnknownRecord; readonly normalized: OperationOptions } {
  const record = asClosedRecord(options, optionName, allowedKeys);
  const maxTimeMs = limit(
    read(record, "maxTimeMs", `${optionName}.maxTimeMs`),
    `${optionName}.maxTimeMs`
  );
  const normalizedSignal = signal(
    read(record, "signal", `${optionName}.signal`),
    `${optionName}.signal`
  );
  return {
    record,
    normalized: Object.freeze({
      ...(maxTimeMs === undefined ? {} : { maxTimeMs }),
      ...(normalizedSignal === undefined ? {} : { signal: normalizedSignal })
    })
  };
}

function normalizeParseLikeOptions(
  options: ParseOptions | ParseBytesOptions | ParseFragmentOptions | ParseStreamOptions,
  budgetKeys: readonly string[],
  allowedKeys: ReadonlySet<PropertyKey>,
  capabilities: {
    readonly sourceRetention: boolean;
    readonly transportEncoding: boolean;
  }
): ParseStreamOptions {
  const record = asClosedRecord(options, "options", allowedKeys);
  const captureSpans = optionalBoolean(
    read(record, "captureSpans", "options.captureSpans"),
    "options.captureSpans"
  );
  const normalizedTrace = traceMode(read(record, "trace", "options.trace"), "options.trace");
  const onTraceEvent = optionalFunction(
    read(record, "onTraceEvent", "options.onTraceEvent"),
    "options.onTraceEvent"
  ) as ParseOptions["onTraceEvent"];
  const normalizedSourceRetention = capabilities.sourceRetention
    ? sourceRetention(read(record, "sourceRetention", "options.sourceRetention"), "options.sourceRetention")
    : undefined;
  const transportEncodingLabel = capabilities.transportEncoding
    ? optionalString(
        read(record, "transportEncodingLabel", "options.transportEncodingLabel"),
        "options.transportEncodingLabel"
      )
    : undefined;
  const budgets = normalizeBudgets(read(record, "budgets", "options.budgets"), budgetKeys) as
    | ParseStreamBudgetOptions
    | undefined;
  const normalizedSignal = signal(read(record, "signal", "options.signal"), "options.signal");
  if (
    normalizedTrace !== "events" &&
    (budgets?.maxTraceEvents !== undefined || budgets?.maxTraceBytes !== undefined)
  ) {
    throw new HtmlConfigurationError(
      "options.budgets",
      "CONFLICTING_OPTIONS",
      'maxTraceEvents and maxTraceBytes require options.trace to be "events"'
    );
  }
  return Object.freeze({
    ...(captureSpans === undefined ? {} : { captureSpans }),
    ...(capabilities.sourceRetention
      ? { sourceRetention: normalizedSourceRetention ?? "none" }
      : {}),
    trace: normalizedTrace ?? "none",
    ...(onTraceEvent === undefined ? {} : { onTraceEvent }),
    ...(transportEncodingLabel === undefined ? {} : { transportEncodingLabel }),
    ...(budgets === undefined ? {} : { budgets }),
    ...(normalizedSignal === undefined ? {} : { signal: normalizedSignal })
  });
}

/** Validates and snapshots document/byte/fragment options exactly once. */
export function normalizeParseOptions(options: ParseOptions): ParseOptions {
  return normalizeParseLikeOptions(
    options,
    PARSE_BUDGET_KEYS,
    PARSE_OPTION_KEYS,
    { sourceRetention: true, transportEncoding: false }
  );
}

/** Validates and snapshots full-document byte options exactly once. */
export function normalizeParseBytesOptions(options: ParseBytesOptions): ParseBytesOptions {
  return normalizeParseLikeOptions(
    options,
    PARSE_BUDGET_KEYS,
    PARSE_BYTES_OPTION_KEYS,
    { sourceRetention: true, transportEncoding: true }
  );
}

/** Validates and snapshots already-decoded fragment options exactly once. */
export function normalizeParseFragmentOptions(options: ParseFragmentOptions): ParseFragmentOptions {
  return normalizeParseLikeOptions(
    options,
    PARSE_BUDGET_KEYS,
    PARSE_FRAGMENT_OPTION_KEYS,
    { sourceRetention: false, transportEncoding: false }
  );
}

/** Validates and snapshots full-document stream options exactly once. */
export function normalizeParseStreamOptions(options: ParseStreamOptions): ParseStreamOptions {
  return normalizeParseLikeOptions(
    options,
    PARSE_STREAM_BUDGET_KEYS,
    PARSE_BYTES_OPTION_KEYS,
    { sourceRetention: true, transportEncoding: true }
  );
}

/** Validates and snapshots eager stream-tokenization options exactly once. */
export function normalizeTokenizeByteStreamEagerOptions(
  options: TokenizeByteStreamEagerOptions
): TokenizeByteStreamEagerOptions {
  const record = asClosedRecord(options, "options", TOKENIZE_BYTE_STREAM_EAGER_OPTION_KEYS);
  const transportEncodingLabel = optionalString(
    read(record, "transportEncodingLabel", "options.transportEncodingLabel"),
    "options.transportEncodingLabel"
  );
  const budgets = normalizeBudgets(
    read(record, "budgets", "options.budgets"),
    TOKENIZE_BYTE_STREAM_EAGER_BUDGET_KEYS
  ) as TokenizeByteStreamEagerBudgetOptions | undefined;
  const normalizedSignal = signal(read(record, "signal", "options.signal"), "options.signal");
  return Object.freeze({
    ...(transportEncodingLabel === undefined ? {} : { transportEncodingLabel }),
    ...(budgets === undefined ? {} : { budgets }),
    ...(normalizedSignal === undefined ? {} : { signal: normalizedSignal })
  });
}

/** Validates and snapshots deadline/cancellation operation options. */
export function normalizeOperationOptions(options: OperationOptions): OperationOptions {
  return normalizeCommonOperationOptions(options, OPERATION_OPTION_KEYS, "options").normalized;
}

/** Validates and snapshots HTML serialization controls. */
export function normalizeSerializeOptions(options: SerializeOptions): Required<Pick<SerializeOptions, "scriptingMode">> & OperationOptions {
  const { record, normalized } = normalizeCommonOperationOptions(
    options,
    SERIALIZE_OPTION_KEYS,
    "options"
  );
  const scriptingMode = read(record, "scriptingMode", "options.scriptingMode");
  if (scriptingMode !== undefined && scriptingMode !== "inert" && scriptingMode !== "disabled") {
    invalidConfiguration("options.scriptingMode", 'must be "inert" or "disabled"');
  }
  return Object.freeze({
    ...normalized,
    scriptingMode: scriptingMode ?? "inert"
  });
}

/** Validates and snapshots one versioned bounded text-extraction policy. */
export function normalizeTextExtractionOptions(options: TextExtractionOptions): TextExtractionOptions {
  const unknownOptions: unknown = options;
  if (typeof unknownOptions !== "object" || unknownOptions === null || Array.isArray(unknownOptions)) {
    invalidConfiguration("options", "must be a plain option object");
  }
  const candidate = unknownOptions as UnknownRecord;
  const policy = textExtractionPolicy(read(candidate, "policy", "options.policy"), "options.policy");
  const record = asClosedRecord(
    candidate,
    "options",
    policy === "visible-text-html-v1"
      ? VISIBLE_TEXT_EXTRACTION_OPTION_KEYS
      : TEXT_CONTENT_EXTRACTION_OPTION_KEYS
  );
  const maxOutputBytes = requiredLimit(
    read(record, "maxOutputBytes", "options.maxOutputBytes"),
    "options.maxOutputBytes"
  );
  const maxTokens = requiredLimit(
    read(record, "maxTokens", "options.maxTokens"),
    "options.maxTokens"
  );
  const maxTimeMs = limit(read(record, "maxTimeMs", "options.maxTimeMs"), "options.maxTimeMs");
  const normalizedSignal = signal(read(record, "signal", "options.signal"), "options.signal");
  const common = {
    policy,
    maxOutputBytes,
    maxTokens,
    ...(maxTimeMs === undefined ? {} : { maxTimeMs }),
    ...(normalizedSignal === undefined ? {} : { signal: normalizedSignal })
  };

  if (policy === "text-content-v1") {
    return Object.freeze(common) as TextContentExtractionOptions;
  }

  const maxFallbackInputBytes = requiredLimit(
    read(record, "maxFallbackInputBytes", "options.maxFallbackInputBytes"),
    "options.maxFallbackInputBytes"
  );
  const maxFallbackNodes = requiredLimit(
    read(record, "maxFallbackNodes", "options.maxFallbackNodes"),
    "options.maxFallbackNodes"
  );
  const skipHiddenSubtrees = optionalBoolean(
    read(record, "skipHiddenSubtrees", "options.skipHiddenSubtrees"),
    "options.skipHiddenSubtrees"
  );
  const includeControlValues = optionalBoolean(
    read(record, "includeControlValues", "options.includeControlValues"),
    "options.includeControlValues"
  );
  const includeAccessibleNameFallback = optionalBoolean(
    read(record, "includeAccessibleNameFallback", "options.includeAccessibleNameFallback"),
    "options.includeAccessibleNameFallback"
  );
  const trim = optionalBoolean(read(record, "trim", "options.trim"), "options.trim");
  return Object.freeze({
    ...common,
    maxFallbackInputBytes,
    maxFallbackNodes,
    ...(skipHiddenSubtrees === undefined ? {} : { skipHiddenSubtrees }),
    ...(includeControlValues === undefined ? {} : { includeControlValues }),
    ...(includeAccessibleNameFallback === undefined ? {} : { includeAccessibleNameFallback }),
    ...(trim === undefined ? {} : { trim })
  });
}

/** Validates and snapshots chunk sizing plus operation controls. */
export function normalizeChunkOptions(options: ChunkOptions): ChunkOptions {
  const { record, normalized } = normalizeCommonOperationOptions(
    options,
    CHUNK_OPTION_KEYS,
    "options"
  );
  const sizing: Partial<Record<"maxChars" | "maxNodes" | "maxBytes", number>> = {};
  for (const key of ["maxChars", "maxNodes", "maxBytes"] as const) {
    const normalizedLimit = limit(read(record, key, `options.${key}`), `options.${key}`);
    if (normalizedLimit !== undefined) {
      sizing[key] = normalizedLimit;
    }
  }
  return Object.freeze({ ...normalized, ...sizing });
}

/** One monotonic deadline and cancellation source shared by an operation's phases. */
export interface OperationContext {
  readonly signal: AbortSignal | undefined;
  readonly timeLimit: number | undefined;
  readonly interruptible: boolean;
  remainingTimeMs(): number | undefined;
  checkpoint(): void;
}

/** Creates an operation context after its owning options have been validated. */
export function createOperationContext(
  maxTimeMs: number | undefined,
  signal: AbortSignal | undefined,
  startedAt = performance.now()
): OperationContext {
  const deadline = maxTimeMs === undefined ? undefined : startedAt + maxTimeMs;
  return {
    signal,
    timeLimit: maxTimeMs,
    interruptible: signal !== undefined || maxTimeMs !== undefined,
    remainingTimeMs(): number | undefined {
      return deadline === undefined ? undefined : Math.max(0, deadline - performance.now());
    },
    checkpoint(): void {
      if (signal?.aborted === true) {
        throw new HtmlAbortError(signal.reason);
      }
      if (maxTimeMs !== undefined && (maxTimeMs === 0 || performance.now() > (deadline ?? startedAt))) {
        throw new HtmlBudgetExceededError("maxTimeMs", maxTimeMs, maxTimeMs + 1);
      }
    }
  };
}
