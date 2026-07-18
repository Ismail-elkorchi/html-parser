import {
  HtmlAbortError,
  HtmlBudgetExceededError,
  HtmlConfigurationError
} from "./errors.js";

import type {
  ParseBudgetOptions,
  ChunkOptions,
  OperationOptions,
  ParseOptions,
  ParseStreamBudgetOptions,
  ParseStreamOptions,
  TokenizeByteStreamEagerBudgetOptions,
  TokenizeByteStreamEagerOptions,
  VisibleTextOptions
} from "./types.js";

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

const PARSE_OPTION_KEYS = new Set<PropertyKey>([
  "captureSpans",
  "trace",
  "transportEncodingLabel",
  "budgets",
  "signal"
]);
const TOKENIZE_BYTE_STREAM_EAGER_OPTION_KEYS = new Set<PropertyKey>([
  "transportEncodingLabel",
  "budgets",
  "signal"
]);
const OPERATION_OPTION_KEYS = new Set<PropertyKey>(["maxTimeMs", "signal"]);
const VISIBLE_TEXT_OPTION_KEYS = new Set<PropertyKey>([
  "skipHiddenSubtrees",
  "includeControlValues",
  "includeAccessibleNameFallback",
  "trim",
  ...OPERATION_OPTION_KEYS
]);
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

function validateOptionalBoolean(record: UnknownRecord, key: string, option: string): void {
  const value = read(record, key, option);
  if (value !== undefined && typeof value !== "boolean") {
    invalidConfiguration(option, "must be a boolean when provided");
  }
}

function validateOptionalString(record: UnknownRecord, key: string, option: string): void {
  const value = read(record, key, option);
  if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
    invalidConfiguration(option, "must be a non-empty string when provided");
  }
}

function validateLimit(value: unknown, option: string): void {
  if (
    value !== undefined &&
    (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0)
  ) {
    invalidConfiguration(option, "must be a finite, non-negative safe integer when provided");
  }
}

function validateSignal(value: unknown, option: string): void {
  if (value === undefined) {
    return;
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
}

function validateBudgets(
  value: unknown,
  keys: readonly string[] = PARSE_BUDGET_KEYS
): void {
  if (value === undefined) {
    return;
  }
  const budgets = asClosedRecord(value, "options.budgets", new Set<PropertyKey>(keys));
  for (const key of keys) {
    validateLimit(read(budgets, key, `options.budgets.${key}`), `options.budgets.${key}`);
  }
}

function validateCommonOperationOptions(
  options: unknown,
  allowedKeys: ReadonlySet<PropertyKey>,
  optionName: string
): UnknownRecord {
  const record = asClosedRecord(options, optionName, allowedKeys);
  validateLimit(read(record, "maxTimeMs", `${optionName}.maxTimeMs`), `${optionName}.maxTimeMs`);
  validateSignal(read(record, "signal", `${optionName}.signal`), `${optionName}.signal`);
  return record;
}

/** Validates the complete runtime schema for document and fragment parsing. */
export function validateParseOptions(options: ParseOptions): void {
  const record = asClosedRecord(options, "options", PARSE_OPTION_KEYS);
  validateOptionalBoolean(record, "captureSpans", "options.captureSpans");
  validateOptionalBoolean(record, "trace", "options.trace");
  validateOptionalString(record, "transportEncodingLabel", "options.transportEncodingLabel");
  validateBudgets(read(record, "budgets", "options.budgets"));
  validateSignal(read(record, "signal", "options.signal"), "options.signal");
}

/** Validates the complete runtime schema for full-document stream parsing. */
export function validateParseStreamOptions(options: ParseStreamOptions): void {
  const record = asClosedRecord(options, "options", PARSE_OPTION_KEYS);
  validateOptionalBoolean(record, "captureSpans", "options.captureSpans");
  validateOptionalBoolean(record, "trace", "options.trace");
  validateOptionalString(record, "transportEncodingLabel", "options.transportEncodingLabel");
  validateBudgets(read(record, "budgets", "options.budgets"), PARSE_STREAM_BUDGET_KEYS);
  validateSignal(read(record, "signal", "options.signal"), "options.signal");
}

/** Validates the complete runtime schema for stream tokenization. */
export function validateTokenizeByteStreamEagerOptions(options: TokenizeByteStreamEagerOptions): void {
  const record = asClosedRecord(options, "options", TOKENIZE_BYTE_STREAM_EAGER_OPTION_KEYS);
  validateOptionalString(record, "transportEncodingLabel", "options.transportEncodingLabel");
  validateBudgets(
    read(record, "budgets", "options.budgets"),
    TOKENIZE_BYTE_STREAM_EAGER_BUDGET_KEYS
  );
  validateSignal(read(record, "signal", "options.signal"), "options.signal");
}

/** Validates deadline/cancellation options used by traversal and serialization. */
export function validateOperationOptions(options: OperationOptions): void {
  validateCommonOperationOptions(options, OPERATION_OPTION_KEYS, "options");
}

/** Validates visible-text policy plus operation controls. */
export function validateVisibleTextOptions(options: VisibleTextOptions): void {
  const record = validateCommonOperationOptions(options, VISIBLE_TEXT_OPTION_KEYS, "options");
  validateOptionalBoolean(record, "skipHiddenSubtrees", "options.skipHiddenSubtrees");
  validateOptionalBoolean(record, "includeControlValues", "options.includeControlValues");
  validateOptionalBoolean(
    record,
    "includeAccessibleNameFallback",
    "options.includeAccessibleNameFallback"
  );
  validateOptionalBoolean(record, "trim", "options.trim");
}

/** Validates chunk sizing plus operation controls. */
export function validateChunkOptions(options: ChunkOptions): void {
  const record = validateCommonOperationOptions(options, CHUNK_OPTION_KEYS, "options");
  for (const key of ["maxChars", "maxNodes", "maxBytes"] as const) {
    const value = read(record, key, `options.${key}`);
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value))
    ) {
      invalidConfiguration(`options.${key}`, "must be a finite, non-negative safe integer when provided");
    }
  }
}

/** One monotonic deadline and cancellation source shared by an operation's phases. */
export interface OperationContext {
  readonly signal: AbortSignal | undefined;
  readonly timeLimit: number | undefined;
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
