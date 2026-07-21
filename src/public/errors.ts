import type {
  HtmlBudgetName,
  HtmlConfigurationErrorReason,
  HtmlPatchPlanningReason,
  NodeId
} from "./types.ts";

type UnknownRecord = Readonly<Record<PropertyKey, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function hasFiniteNumber(record: UnknownRecord, key: PropertyKey): boolean {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value);
}

function hasString(record: UnknownRecord, key: PropertyKey): boolean {
  return typeof record[key] === "string";
}

function hasErrorShape(record: UnknownRecord): boolean {
  return hasString(record, "name") && hasString(record, "message");
}

const BUDGET_NAMES: ReadonlySet<string> = new Set<HtmlBudgetName>([
  "maxInputBytes",
  "maxDecodedUtf8Bytes",
  "maxNodes",
  "maxDepth",
  "maxParseErrors",
  "maxAttributesPerElement",
  "maxAttributeBytes",
  "maxTraceEvents",
  "maxTraceBytes",
  "maxFallbackInputBytes",
  "maxFallbackNodes",
  "maxTimeMs"
]);

const CONFIGURATION_REASONS: ReadonlySet<string> = new Set<HtmlConfigurationErrorReason>([
  "UNKNOWN_OPTION",
  "INVALID_VALUE",
  "CONFLICTING_OPTIONS"
]);

const PATCH_REASONS: ReadonlySet<string> = new Set<HtmlPatchPlanningReason>([
  "UNRECOGNIZED_PARSED_DOCUMENT",
  "SOURCE_NOT_RETAINED",
  "SPANS_NOT_CAPTURED",
  "PLAN_SOURCE_MISMATCH",
  "NODE_NOT_FOUND",
  "MISSING_NODE_SPAN",
  "NON_INPUT_SPAN_PROVENANCE",
  "INVALID_EDIT",
  "INVALID_EDIT_TARGET",
  "CONFLICTING_EDITS",
  "UNREPRESENTABLE_TEXT_VALUE",
  "ATTRIBUTE_NOT_FOUND",
  "ATTRIBUTE_NAMESPACE_UNSUPPORTED",
  "ATTRIBUTE_SPAN_MISSING",
  "ELEMENT_START_TAG_NOT_FOUND",
  "OVERLAPPING_EDITS",
  "INVALID_PLAN_SLICE",
  "INVALID_PLAN_INSERTION"
]);

/** A configured HTML parser resource limit was exceeded. */
export class HtmlBudgetExceededError extends Error {
  /** Stable structural discriminator for budget failures. */
  readonly code = "BUDGET_EXCEEDED";
  /** Resource limit that was exceeded. */
  readonly budget: HtmlBudgetName;
  /** Inclusive configured maximum for the resource. */
  readonly limit: number;
  /** First observed value beyond the configured maximum. */
  readonly actual: number;

  /** Creates an immutable budget failure with direct classification fields. */
  constructor(budget: HtmlBudgetName, limit: number, actual: number) {
    super(`Budget exceeded: ${budget} limit=${String(limit)} actual=${String(actual)}`);
    this.name = "HtmlBudgetExceededError";
    this.budget = budget;
    this.limit = limit;
    this.actual = actual;
    Object.freeze(this);
  }
}

/** Parser options or a required parsing argument are invalid. */
export class HtmlConfigurationError extends Error {
  /** Stable structural discriminator for configuration failures. */
  readonly code = "INVALID_CONFIGURATION";
  /** Option or required argument whose configuration is invalid. */
  readonly option: string;
  /** Machine-readable category describing the configuration failure. */
  readonly reason: HtmlConfigurationErrorReason;
  /** Human-readable statement of the accepted configuration. */
  readonly expected: string;

  /** Creates an immutable configuration failure with direct classification fields. */
  constructor(option: string, reason: HtmlConfigurationErrorReason, expected: string) {
    super(`Invalid HTML parser configuration: ${option} ${expected}`);
    this.name = "HtmlConfigurationError";
    this.option = option;
    this.reason = reason;
    this.expected = expected;
    Object.freeze(this);
  }
}

/** A structural edit or patch plan cannot be applied safely. */
export class HtmlPatchPlanningError extends Error {
  /** Stable structural discriminator for patch-planning failures. */
  readonly code = "PATCH_PLANNING_FAILED";
  /** Machine-readable reason the edit or patch plan is unsafe. */
  readonly reason: HtmlPatchPlanningReason;
  /** Node targeted by the failed edit, when a node is involved. */
  readonly target?: NodeId;
  /** Additional stable context for the failed patch operation. */
  readonly detail?: string;

  /** Creates an immutable patch failure with optional target context. */
  constructor(reason: HtmlPatchPlanningReason, options: { readonly target?: NodeId; readonly detail?: string } = {}) {
    super(
      `Patch planning failed: ${reason}${
        options.target === undefined ? "" : ` target=${String(options.target)}`
      }`
    );
    this.name = "HtmlPatchPlanningError";
    this.reason = reason;
    if (options.target !== undefined) {
      this.target = options.target;
    }
    if (options.detail !== undefined) {
      this.detail = options.detail;
    }
    Object.freeze(this);
  }
}

/** The supplied byte stream failed while acquiring or reading its reader. */
export class HtmlStreamReadError extends Error {
  /** Stable structural discriminator for stream acquisition/read failures. */
  readonly code = "STREAM_READ_FAILED";
  /** Exact value thrown by the source stream. */
  declare readonly cause: unknown;

  /** Creates an immutable stream failure that preserves the original cause. */
  constructor(cause: unknown) {
    super("Unable to read HTML byte stream", { cause });
    this.name = "HtmlStreamReadError";
    Object.freeze(this);
  }
}

/** An HTML parser operation was cancelled through its abort signal. */
export class HtmlAbortError extends Error {
  /** Stable structural discriminator for cancellation. */
  readonly code = "ABORTED";
  /** Exact reason exposed by the aborted signal. */
  declare readonly cause: unknown;

  /** Creates an immutable cancellation failure that preserves the signal reason. */
  constructor(cause: unknown) {
    super("HTML parser operation aborted", { cause });
    this.name = "HtmlAbortError";
    Object.freeze(this);
  }
}

/** Classifies budget failures across JavaScript realms and package copies. */
export function isHtmlBudgetExceededError(value: unknown): value is HtmlBudgetExceededError {
  if (!isRecord(value)) {
    return false;
  }
  try {
    return hasErrorShape(value) &&
      value["code"] === "BUDGET_EXCEEDED" &&
      typeof value["budget"] === "string" &&
      BUDGET_NAMES.has(value["budget"]) &&
      hasFiniteNumber(value, "limit") &&
      hasFiniteNumber(value, "actual");
  } catch {
    return false;
  }
}

/** Classifies invalid parser configuration across realms and package copies. */
export function isHtmlConfigurationError(value: unknown): value is HtmlConfigurationError {
  if (!isRecord(value)) {
    return false;
  }
  try {
    return hasErrorShape(value) &&
      value["code"] === "INVALID_CONFIGURATION" &&
      hasString(value, "option") &&
      typeof value["reason"] === "string" &&
      CONFIGURATION_REASONS.has(value["reason"]) &&
      hasString(value, "expected");
  } catch {
    return false;
  }
}

/** Classifies patch-planning failures across realms and package copies. */
export function isHtmlPatchPlanningError(value: unknown): value is HtmlPatchPlanningError {
  if (!isRecord(value)) {
    return false;
  }
  try {
    const target = value["target"];
    const detail = value["detail"];
    return hasErrorShape(value) &&
      value["code"] === "PATCH_PLANNING_FAILED" &&
      typeof value["reason"] === "string" &&
      PATCH_REASONS.has(value["reason"]) &&
      (target === undefined || (typeof target === "number" && Number.isInteger(target))) &&
      (detail === undefined || typeof detail === "string");
  } catch {
    return false;
  }
}

/** Classifies stream acquisition/read failures and preserves their cause. */
export function isHtmlStreamReadError(value: unknown): value is HtmlStreamReadError {
  if (!isRecord(value)) {
    return false;
  }
  try {
    return hasErrorShape(value) && value["code"] === "STREAM_READ_FAILED" && "cause" in value;
  } catch {
    return false;
  }
}

/** Classifies HTML parser cancellation across realms and package copies. */
export function isHtmlAbortError(value: unknown): value is HtmlAbortError {
  if (!isRecord(value)) {
    return false;
  }
  try {
    return hasErrorShape(value) && value["code"] === "ABORTED" && "cause" in value;
  } catch {
    return false;
  }
}

/** Any structured operational failure thrown by the HTML parser. */
export type HtmlOperationalError =
  | HtmlAbortError
  | HtmlBudgetExceededError
  | HtmlConfigurationError
  | HtmlPatchPlanningError
  | HtmlStreamReadError;

/** Classifies any structured operational failure exported by this package. */
export function isHtmlOperationalError(value: unknown): value is HtmlOperationalError {
  return isHtmlAbortError(value) ||
    isHtmlBudgetExceededError(value) ||
    isHtmlConfigurationError(value) ||
    isHtmlPatchPlanningError(value) ||
    isHtmlStreamReadError(value);
}
