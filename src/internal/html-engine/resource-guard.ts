/** Internal resources guarded before unavailable work or allocation is committed. */
export type EngineResourceLimitName =
  | "maxSteps"
  | "maxNodes"
  | "maxDepth"
  | "maxParseErrors"
  | "maxAttributesPerElement"
  | "maxAttributeUtf8BytesPerElement"
  | "maxTimeMs";

/** Inclusive internal limits; all values are non-negative safe integers. */
export type EngineResourceLimits = Readonly<
  Partial<Record<EngineResourceLimitName, number>>
>;

/** Deterministic successful work and allocation observations. */
export interface EngineResourceUsage {
  readonly steps: number;
  readonly nodes: number;
  readonly maxDepth: number;
  readonly parseErrors: number;
  readonly attributes: number;
  readonly attributeUtf8Bytes: number;
}

/** Invalid internal driver/resource configuration. */
export class EngineConfigurationError extends Error {
  readonly code = "INVALID_ENGINE_CONFIGURATION";
  readonly option: string;

  constructor(option: string, expected: string) {
    super(`Invalid engine configuration: ${option} ${expected}`);
    this.name = "EngineConfigurationError";
    this.option = option;
    Object.freeze(this);
  }
}

/** An internal engine resource boundary was reached. */
export class EngineResourceLimitError extends Error {
  readonly code = "ENGINE_RESOURCE_LIMIT_EXCEEDED";
  readonly resource: EngineResourceLimitName;
  readonly limit: number;
  readonly actual: number;

  constructor(resource: EngineResourceLimitName, limit: number, actual: number) {
    super(`Engine resource limit exceeded: ${resource} limit=${String(limit)} actual=${String(actual)}`);
    this.name = "EngineResourceLimitError";
    this.resource = resource;
    this.limit = limit;
    this.actual = actual;
    Object.freeze(this);
  }
}

/** Internal cancellation preserving the exact AbortSignal reason. */
export class EngineAbortError extends Error {
  readonly code = "ENGINE_ABORTED";
  declare readonly cause: unknown;

  constructor(cause: unknown) {
    super("HTML engine operation aborted", { cause });
    this.name = "EngineAbortError";
    Object.freeze(this);
  }
}

/** Per-start-tag attribute boundary. */
export interface StartTagResourceGuard {
  beginAttribute(): void;
  appendCodePoint(value: string): void;
}

/** Minimal final-tree attribute shape needed by element resource checks. */
interface ElementResourceAttribute {
  readonly qualifiedName: string;
  readonly value: string;
}

/** Resource boundary shared by one engine operation. */
export interface EngineResourceGuard {
  ensureActive(): void;
  checkpoint(): void;
  reserveNode(): void;
  reserveNodes(count: number): void;
  reserveNodeAtDepth(depth: number): void;
  observeDepth(depth: number): void;
  reserveParseError(): void;
  beginStartTag(): StartTagResourceGuard;
  checkElementAttributes(attributes: readonly ElementResourceAttribute[]): void;
  snapshot(): EngineResourceUsage;
}

export interface EngineResourceGuardOptions {
  readonly limits?: EngineResourceLimits;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly startedAt?: number;
  /** Retains the internal deterministic step counter; production callers can disable it. */
  readonly trackSteps?: boolean;
}

const LIMIT_NAMES = Object.freeze([
  "maxSteps",
  "maxNodes",
  "maxDepth",
  "maxParseErrors",
  "maxAttributesPerElement",
  "maxAttributeUtf8BytesPerElement",
  "maxTimeMs"
] as const satisfies readonly EngineResourceLimitName[]);

function validateLimit(value: unknown, option: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new EngineConfigurationError(option, "must be a non-negative safe integer");
  }
  return value;
}

function validateOptions(options: EngineResourceGuardOptions): {
  readonly limits: EngineResourceLimits;
  readonly signal: AbortSignal | undefined;
  readonly now: () => number;
  readonly startedAt: number;
  readonly trackSteps: boolean;
} {
  const unknownOptions: unknown = options;
  if (typeof unknownOptions !== "object" || unknownOptions === null || Array.isArray(unknownOptions)) {
    throw new EngineConfigurationError("options", "must be an object");
  }

  const optionRecord = unknownOptions as Readonly<Record<PropertyKey, unknown>>;
  const allowedOptions = new Set<PropertyKey>([
    "limits", "signal", "now", "startedAt", "trackSteps"
  ]);
  for (const key of Reflect.ownKeys(optionRecord)) {
    if (!allowedOptions.has(key)) {
      throw new EngineConfigurationError(`options.${String(key)}`, "is not supported");
    }
  }

  const unknownLimits = optionRecord["limits"];
  if (
    unknownLimits !== undefined &&
    (typeof unknownLimits !== "object" || unknownLimits === null || Array.isArray(unknownLimits))
  ) {
    throw new EngineConfigurationError("options.limits", "must be an object");
  }
  const limitRecord = (unknownLimits ?? {}) as Readonly<Record<PropertyKey, unknown>>;
  const allowedLimits = new Set<PropertyKey>(LIMIT_NAMES);
  for (const key of Reflect.ownKeys(limitRecord)) {
    if (!allowedLimits.has(key)) {
      throw new EngineConfigurationError(`options.limits.${String(key)}`, "is not supported");
    }
  }
  const normalizedLimits: Partial<Record<EngineResourceLimitName, number>> = {};
  for (const name of LIMIT_NAMES) {
    const value = validateLimit(limitRecord[name], `options.limits.${name}`);
    if (value !== undefined) normalizedLimits[name] = value;
  }

  const unknownSignal = optionRecord["signal"];
  if (
    unknownSignal !== undefined &&
    (typeof unknownSignal !== "object" ||
      unknownSignal === null ||
      typeof (unknownSignal as Readonly<Record<string, unknown>>)["aborted"] !== "boolean" ||
      typeof (unknownSignal as Readonly<Record<string, unknown>>)["addEventListener"] !== "function" ||
      typeof (unknownSignal as Readonly<Record<string, unknown>>)["removeEventListener"] !== "function")
  ) {
    throw new EngineConfigurationError("options.signal", "must be an AbortSignal");
  }

  const unknownNow = optionRecord["now"];
  if (unknownNow !== undefined && typeof unknownNow !== "function") {
    throw new EngineConfigurationError("options.now", "must be a function");
  }
  const now = (unknownNow ?? performance.now.bind(performance)) as () => number;
  const unknownStartedAt = optionRecord["startedAt"];
  if (
    unknownStartedAt !== undefined &&
    (typeof unknownStartedAt !== "number" || !Number.isFinite(unknownStartedAt))
  ) {
    throw new EngineConfigurationError("options.startedAt", "must be a finite number");
  }
  const startedAt = unknownStartedAt ?? now();
  if (!Number.isFinite(startedAt)) {
    throw new EngineConfigurationError("options.startedAt", "must resolve to a finite number");
  }

  const unknownTrackSteps = optionRecord["trackSteps"];
  if (unknownTrackSteps !== undefined && typeof unknownTrackSteps !== "boolean") {
    throw new EngineConfigurationError("options.trackSteps", "must be a boolean");
  }
  const trackSteps = unknownTrackSteps ?? true;
  if (!trackSteps && normalizedLimits.maxSteps !== undefined) {
    throw new EngineConfigurationError(
      "options.trackSteps",
      "must be true when limits.maxSteps is configured"
    );
  }

  return {
    limits: Object.freeze(normalizedLimits),
    signal: unknownSignal as AbortSignal | undefined,
    now,
    startedAt,
    trackSteps
  };
}

function codePointUtf8ByteLength(value: string): number {
  const codePoint = value.codePointAt(0);
  const representedCodeUnits = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
  if (codePoint === undefined || value.length !== representedCodeUnits) {
    throw new EngineConfigurationError("attribute code point", "must contain exactly one code point");
  }
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function stringUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (const codePoint of value) bytes += codePointUtf8ByteLength(codePoint);
  return bytes;
}

/** Creates one validated resource guard before engine work begins. */
export function createEngineResourceGuard(
  options: EngineResourceGuardOptions = {}
): EngineResourceGuard {
  const { limits, signal, now, startedAt, trackSteps } = validateOptions(options);
  const deadline = limits.maxTimeMs === undefined ? undefined : startedAt + limits.maxTimeMs;
  let steps = 0;
  let nodes = 0;
  let maxDepth = 0;
  let parseErrors = 0;
  let attributes = 0;
  let attributeUtf8Bytes = 0;

  if (Reflect.ownKeys(limits).length === 0 && signal === undefined) {
    const guard: EngineResourceGuard = {
      ensureActive(): void {},
      checkpoint(): void { if (trackSteps) steps += 1; },
      reserveNode(): void {
        if (trackSteps) steps += 1;
        nodes += 1;
      },
      reserveNodes(count: number): void {
        if (!Number.isSafeInteger(count) || count < 1) {
          throw new EngineConfigurationError("node reservation count", "must be a positive safe integer");
        }
        if (trackSteps) steps += count;
        nodes += count;
      },
      reserveNodeAtDepth(depth: number): void {
        if (!Number.isSafeInteger(depth) || depth < 1) {
          throw new EngineConfigurationError("depth", "must be a positive safe integer");
        }
        if (trackSteps) steps += 1;
        nodes += 1;
        maxDepth = Math.max(maxDepth, depth);
      },
      observeDepth(depth: number): void {
        if (!Number.isSafeInteger(depth) || depth < 1) {
          throw new EngineConfigurationError("depth", "must be a positive safe integer");
        }
        if (trackSteps) steps += 1;
        maxDepth = Math.max(maxDepth, depth);
      },
      reserveParseError(): void {
        if (trackSteps) steps += 1;
        parseErrors += 1;
      },
      beginStartTag(): StartTagResourceGuard {
        if (trackSteps) steps += 1;
        return {
          beginAttribute(): void {
            if (trackSteps) steps += 1;
            attributes += 1;
          },
          appendCodePoint(value: string): void {
            if (trackSteps) steps += 1;
            attributeUtf8Bytes += codePointUtf8ByteLength(value);
          }
        };
      },
      checkElementAttributes(): void {},
      snapshot(): EngineResourceUsage {
        return Object.freeze({
          steps,
          nodes,
          maxDepth,
          parseErrors,
          attributes,
          attributeUtf8Bytes
        });
      }
    };
    return Object.freeze(guard);
  }

  function fail(resource: EngineResourceLimitName, limit: number, actual: number): never {
    throw new EngineResourceLimitError(resource, limit, actual);
  }

  function checkLimit(resource: EngineResourceLimitName, actual: number): void {
    const limit = limits[resource];
    if (limit !== undefined && actual > limit) fail(resource, limit, actual);
  }

  function validateDepth(depth: number): void {
    if (!Number.isSafeInteger(depth) || depth < 1) {
      throw new EngineConfigurationError("depth", "must be a positive safe integer");
    }
  }

  const guard: EngineResourceGuard = {
    ensureActive(): void {
      if (signal?.aborted === true) throw new EngineAbortError(signal.reason);
      const maxTimeMs = limits.maxTimeMs;
      if (
        maxTimeMs !== undefined &&
        (maxTimeMs === 0 || now() > (deadline ?? startedAt))
      ) {
        fail("maxTimeMs", maxTimeMs, maxTimeMs + 1);
      }
    },
    checkpoint(): void {
      guard.ensureActive();
      if (!trackSteps) return;
      const actual = steps + 1;
      checkLimit("maxSteps", actual);
      steps = actual;
    },
    reserveNode(): void {
      guard.reserveNodes(1);
    },
    reserveNodes(count: number): void {
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new EngineConfigurationError("node reservation count", "must be a positive safe integer");
      }
      guard.ensureActive();
      const actualSteps = steps + count;
      if (trackSteps) {
        const stepLimit = limits.maxSteps;
        if (stepLimit !== undefined && actualSteps > stepLimit) {
          fail("maxSteps", stepLimit, stepLimit + 1);
        }
      }
      const actualNodes = nodes + count;
      const nodeLimit = limits.maxNodes;
      if (nodeLimit !== undefined && actualNodes > nodeLimit) {
        fail("maxNodes", nodeLimit, nodeLimit + 1);
      }
      if (trackSteps) steps = actualSteps;
      nodes = actualNodes;
    },
    reserveNodeAtDepth(depth: number): void {
      guard.checkpoint();
      validateDepth(depth);
      const actualNodes = nodes + 1;
      checkLimit("maxNodes", actualNodes);
      checkLimit("maxDepth", depth);
      nodes = actualNodes;
      maxDepth = Math.max(maxDepth, depth);
    },
    observeDepth(depth: number): void {
      guard.checkpoint();
      validateDepth(depth);
      checkLimit("maxDepth", depth);
      maxDepth = Math.max(maxDepth, depth);
    },
    reserveParseError(): void {
      guard.checkpoint();
      const actual = parseErrors + 1;
      checkLimit("maxParseErrors", actual);
      parseErrors = actual;
    },
    beginStartTag(): StartTagResourceGuard {
      guard.checkpoint();
      let attemptedAttributes = 0;
      let tagAttributeUtf8Bytes = 0;
      return {
        beginAttribute(): void {
          guard.checkpoint();
          const actual = attemptedAttributes + 1;
          checkLimit("maxAttributesPerElement", actual);
          attemptedAttributes = actual;
          attributes += 1;
        },
        appendCodePoint(value: string): void {
          guard.checkpoint();
          const bytes = codePointUtf8ByteLength(value);
          const actual = tagAttributeUtf8Bytes + bytes;
          checkLimit("maxAttributeUtf8BytesPerElement", actual);
          tagAttributeUtf8Bytes = actual;
          attributeUtf8Bytes += bytes;
        }
      };
    },
    checkElementAttributes(elementAttributes): void {
      guard.ensureActive();
      const attributeLimit = limits.maxAttributesPerElement;
      if (attributeLimit !== undefined && elementAttributes.length > attributeLimit) {
        fail("maxAttributesPerElement", attributeLimit, attributeLimit + 1);
      }
      const byteLimit = limits.maxAttributeUtf8BytesPerElement;
      if (byteLimit === undefined) return;
      let bytes = 0;
      for (const attribute of elementAttributes) {
        bytes += stringUtf8ByteLength(attribute.qualifiedName);
        bytes += stringUtf8ByteLength(attribute.value);
        if (bytes > byteLimit) {
          fail("maxAttributeUtf8BytesPerElement", byteLimit, byteLimit + 1);
        }
      }
    },
    snapshot(): EngineResourceUsage {
      return Object.freeze({
        steps,
        nodes,
        maxDepth,
        parseErrors,
        attributes,
        attributeUtf8Bytes
      });
    }
  };
  return Object.freeze(guard);
}
