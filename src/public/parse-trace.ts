import { enforceBudget } from "./budgets.ts";

import type { OperationContext } from "./operation.ts";
import type {
  HtmlBudgetName,
  ParseOptions,
  TraceEvent,
  TraceEventCallback,
  TraceMode,
  TraceResult,
  TraceSummary
} from "./types.ts";

type TraceEventInput = TraceEvent extends infer Event
  ? Event extends { readonly seq: number }
    ? Omit<Event, "seq">
    : never
  : never;

export interface TraceFinalMetrics {
  readonly tokenCount: number;
  readonly nodeCount: number;
  readonly maxDepth: number;
  readonly parseErrorCount: number;
  readonly encoding: TraceSummary["encoding"];
  readonly inputBytes: number;
  readonly decodedUtf8Bytes: number;
  readonly bytesRead: number | null;
  readonly encodingPrescanBytes: number | null;
  readonly encodingPrescanLimitBytes: number | null;
}

const WHATWG_PARSE_ERROR_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Normalizes standard and non-standard diagnostic identifiers without hiding provenance. */
export function normalizeParseErrorId(rawErrorCode: string): string {
  const normalized = rawErrorCode.trim();
  if (normalized.length === 0) return "vendor:unknown";
  return WHATWG_PARSE_ERROR_ID_PATTERN.test(normalized)
    ? normalized
    : `vendor:${normalized}`;
}

function freezeTraceEvent(seq: number, input: TraceEventInput): TraceEvent {
  if (input.kind === "insertionModeTransition") {
    return Object.freeze({
      seq,
      ...input,
      tokenContext: Object.freeze({ ...input.tokenContext })
    });
  }
  return Object.freeze({ seq, ...input });
}

/** One operation-local trace observer and optional retention sink. */
export class TraceSink {
  readonly #mode: TraceMode;
  readonly #callback: TraceEventCallback | undefined;
  readonly #budgets: ParseOptions["budgets"] | undefined;
  readonly #operation: OperationContext;
  readonly #encoder = new TextEncoder();
  readonly #events: TraceEvent[] | undefined;
  readonly #eventKinds = new Set<TraceEvent["kind"]>();
  #eventCount = 0;
  #eventUtf8Bytes = 0;

  constructor(
    mode: TraceMode,
    callback: TraceEventCallback | undefined,
    budgets: ParseOptions["budgets"] | undefined,
    operation: OperationContext
  ) {
    this.#mode = mode;
    this.#callback = callback;
    this.#budgets = budgets;
    this.#operation = operation;
    this.#events = mode === "events" ? [] : undefined;
  }

  get active(): boolean {
    return this.#mode !== "none" || this.#callback !== undefined;
  }

  get eventCount(): number {
    return this.#eventCount;
  }

  get eventUtf8Bytes(): number {
    return this.#eventUtf8Bytes;
  }

  emit(input: TraceEventInput): void {
    if (!this.active) return;
    this.#operation.checkpoint();
    const event = freezeTraceEvent(this.#eventCount + 1, input);
    const eventBytes = this.#mode === "none"
      ? 0
      : this.#encoder.encode(JSON.stringify(event)).byteLength;
    if (this.#events !== undefined) {
      enforceBudget("maxTraceEvents", this.#budgets?.maxTraceEvents, this.#events.length + 1);
      enforceBudget("maxTraceBytes", this.#budgets?.maxTraceBytes, this.#eventUtf8Bytes + eventBytes);
      this.#events.push(event);
    }
    this.#eventCount += 1;
    if (this.#mode !== "none") {
      this.#eventUtf8Bytes += eventBytes;
      this.#eventKinds.add(event.kind);
    }
    this.#callback?.(event);
    this.#operation.checkpoint();
  }

  emitBudget(budget: HtmlBudgetName, limit: number | undefined, actual: number): void {
    this.emit({
      kind: "budget",
      budget,
      limit: limit ?? null,
      actual,
      status: limit === undefined || actual <= limit ? "ok" : "exceeded"
    });
  }

  finish(metrics: TraceFinalMetrics): TraceResult | undefined {
    if (this.#mode === "none") return undefined;
    const summary: TraceSummary = Object.freeze({
      ...metrics,
      encoding: Object.freeze({ ...metrics.encoding }),
      eventCount: this.#eventCount,
      eventUtf8Bytes: this.#eventUtf8Bytes,
      eventKinds: Object.freeze([...this.#eventKinds].sort())
    });
    if (this.#events === undefined) return Object.freeze({ mode: "summary", summary });
    return Object.freeze({ mode: "events", summary, events: Object.freeze(this.#events) });
  }
}
