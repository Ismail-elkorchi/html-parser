import {
  decideHtmlEncoding,
  sniffHtmlEncoding
} from "../internal/encoding/sniff.ts";
import { failInternalState } from "../internal/foundation/internal-state-error.ts";

import { enforceBudget } from "./budgets.ts";
import {
  HtmlAbortError,
  HtmlBudgetExceededError,
  HtmlConfigurationError,
  HtmlStreamReadError
} from "./errors.ts";

import type { OperationContext } from "./operation.ts";
import type { ParseStreamBudgetOptions, TokenizeByteStreamEagerOptions } from "./types.ts";

const DEFAULT_STREAM_ENCODING_PRESCAN_BYTES = 16_384;
const ASCII_ONLY = /^[\u0000-\u007f]*$/;

interface StreamEncodingSniff {
  readonly encoding: string;
  readonly source: "bom" | "transport" | "meta" | "default";
}

interface StreamDecodeResult {
  readonly text: string | null;
  readonly sniff: StreamEncodingSniff;
  readonly totalBytes: number;
  readonly decodedUtf8Bytes: number;
  readonly decodedCodeUnits: number;
  readonly encodingPrescanBytes: number;
  readonly encodingPrescanLimitBytes: number;
}

interface StreamDecoderState {
  readonly decoder: TextDecoder;
  readonly sniff: StreamEncodingSniff;
}

interface DecodeCallbacks {
  readonly retainText: boolean;
  readonly onEncodingSniff?: (sniff: StreamEncodingSniff) => void;
  readonly onDecodedChunk?: (chunk: string) => void;
}

export function requireString(value: unknown, option: string): asserts value is string {
  if (typeof value !== "string") {
    throw new HtmlConfigurationError(option, "INVALID_VALUE", "must be a string");
  }
}

export function requireByteArray(value: unknown, option: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new HtmlConfigurationError(option, "INVALID_VALUE", "must be a Uint8Array");
  }
}

export function requireReadableByteStream(
  value: unknown,
  option: string
): asserts value is ReadableStream<Uint8Array> {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Readonly<Record<PropertyKey, unknown>>)["getReader"] !== "function"
  ) {
    throw new HtmlConfigurationError(
      option,
      "INVALID_VALUE",
      "must be a ReadableStream of Uint8Array chunks"
    );
  }
}

function codePointUtf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

export function utf8ByteLength(value: string, operation?: OperationContext): number {
  if (operation?.interruptible !== true && ASCII_ONLY.test(value)) return value.length;
  let bytes = 0;
  let cursor = 0;
  while (cursor < value.length) {
    if (operation?.interruptible === true) operation.checkpoint();
    const codePoint = value.codePointAt(cursor);
    if (codePoint === undefined) break;
    bytes += codePointUtf8ByteLength(codePoint);
    cursor += codePoint > 0xffff ? 2 : 1;
  }
  return bytes;
}

export class DecodedUtf8BudgetCounter {
  readonly #limit: number | undefined;
  readonly #operation: OperationContext;
  readonly #encoder = new TextEncoder();
  #bytes = 0;

  constructor(limit: number | undefined, operation: OperationContext) {
    this.#limit = limit;
    this.#operation = operation;
  }

  append(value: string): void {
    this.#operation.checkpoint();
    this.#bytes += this.#encoder.encode(value).byteLength;
    enforceBudget("maxDecodedUtf8Bytes", this.#limit, this.#bytes);
  }

  get bytes(): number {
    return this.#bytes;
  }
}

class DecodedOutputCollector {
  readonly #operation: OperationContext;
  readonly #budget: DecodedUtf8BudgetCounter;
  readonly #parts: string[] | null;
  readonly #onDecodedChunk: ((chunk: string) => void) | undefined;
  #codeUnits = 0;

  constructor(
    limit: number | undefined,
    callbacks: DecodeCallbacks,
    operation: OperationContext
  ) {
    this.#operation = operation;
    this.#budget = new DecodedUtf8BudgetCounter(limit, operation);
    this.#parts = callbacks.retainText ? [] : null;
    this.#onDecodedChunk = callbacks.onDecodedChunk;
  }

  append(value: string): void {
    if (value.length === 0) return;
    this.#budget.append(value);
    const nextCodeUnits = this.#codeUnits + value.length;
    if (!Number.isSafeInteger(nextCodeUnits)) {
      throw new HtmlConfigurationError(
        "input",
        "INVALID_VALUE",
        "decoded input must fit in a safe UTF-16 code-unit count"
      );
    }
    this.#codeUnits = nextCodeUnits;
    this.#onDecodedChunk?.(value);
    this.#parts?.push(value);
    this.#operation.checkpoint();
  }

  get bytes(): number {
    return this.#budget.bytes;
  }

  get codeUnits(): number {
    return this.#codeUnits;
  }

  text(): string | null {
    return this.#parts?.join("") ?? null;
  }
}

function decodeTransportBytes(
  decoder: TextDecoder,
  bytes: Uint8Array,
  output: DecodedOutputCollector,
  operation: OperationContext
): void {
  const decodeChunkBytes = 16_384;
  for (let offset = 0; offset < bytes.byteLength; offset += decodeChunkBytes) {
    operation.checkpoint();
    output.append(decoder.decode(bytes.subarray(offset, offset + decodeChunkBytes), { stream: true }));
  }
}

/** Decodes an in-memory byte input without retaining decoded text unless requested. */
export function decodeByteArray(
  bytes: Uint8Array,
  options: DecodeCallbacks & {
    readonly transportEncodingLabel?: string;
    readonly maxDecodedUtf8Bytes?: number;
  },
  operation: OperationContext
): StreamDecodeResult {
  operation.checkpoint();
  const sniff = sniffHtmlEncoding(bytes, options.transportEncodingLabel === undefined
    ? {}
    : { transportEncodingLabel: options.transportEncodingLabel });
  options.onEncodingSniff?.(sniff);
  const output = new DecodedOutputCollector(options.maxDecodedUtf8Bytes, options, operation);
  const decoder = new TextDecoder(sniff.encoding);
  decodeTransportBytes(decoder, bytes, output, operation);
  output.append(decoder.decode());
  return Object.freeze({
    text: output.text(),
    sniff,
    totalBytes: bytes.byteLength,
    decodedUtf8Bytes: output.bytes,
    decodedCodeUnits: output.codeUnits,
    encodingPrescanBytes: 0,
    encodingPrescanLimitBytes: 0
  });
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  operation: OperationContext
): Promise<ReadableStreamReadResult<Uint8Array>> {
  operation.checkpoint();
  let readPromise: Promise<ReadableStreamReadResult<Uint8Array>>;
  try {
    readPromise = reader.read();
  } catch (cause) {
    throw new HtmlStreamReadError(cause);
  }

  const signal = operation.signal;
  const remainingTimeMs = operation.remainingTimeMs();
  if (!signal && remainingTimeMs === undefined) {
    try {
      return await readPromise;
    } catch (cause) {
      throw new HtmlStreamReadError(cause);
    }
  }

  let abortListener: (() => void) | undefined;
  const abortPromise = signal
    ? new Promise<never>((_resolve, reject) => {
        abortListener = () => { reject(new HtmlAbortError(signal.reason)); };
        signal.addEventListener("abort", abortListener, { once: true });
        if (signal.aborted) abortListener();
      })
    : undefined;
  let deadlineTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const deadlinePromise = remainingTimeMs === undefined
    ? undefined
    : new Promise<never>((_resolve, reject) => {
        deadlineTimer = globalThis.setTimeout(() => {
          const limit = operation.timeLimit ?? 0;
          reject(new HtmlBudgetExceededError("maxTimeMs", limit, limit + 1));
        }, Math.ceil(remainingTimeMs));
      });

  try {
    return await Promise.race([
      readPromise,
      ...(abortPromise ? [abortPromise] : []),
      ...(deadlinePromise ? [deadlinePromise] : [])
    ]);
  } catch (cause) {
    if (cause instanceof HtmlAbortError || cause instanceof HtmlBudgetExceededError) throw cause;
    throw new HtmlStreamReadError(cause);
  } finally {
    if (abortListener) signal?.removeEventListener("abort", abortListener);
    if (deadlineTimer !== undefined) globalThis.clearTimeout(deadlineTimer);
  }
}

/** Reads and decodes one byte stream under a shared operation lifecycle. */
export async function decodeByteStream(
  stream: ReadableStream<Uint8Array>,
  options: {
    readonly transportEncodingLabel?: string;
    readonly budgets?: ParseStreamBudgetOptions | TokenizeByteStreamEagerOptions["budgets"];
    readonly retainText: boolean;
    readonly onEncodingSniff?: (sniff: StreamEncodingSniff) => void;
    readonly onDecodedChunk?: (chunk: string) => void;
  },
  operation: OperationContext
): Promise<StreamDecodeResult> {
  const budgets = options.budgets;
  operation.checkpoint();
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = stream.getReader();
  } catch (cause) {
    throw new HtmlStreamReadError(cause);
  }
  let total = 0;
  const prescanLimit = Math.min(
    DEFAULT_STREAM_ENCODING_PRESCAN_BYTES,
    budgets?.maxEncodingPrescanBytes ?? DEFAULT_STREAM_ENCODING_PRESCAN_BYTES
  );
  const pendingBytesBuffer = new Uint8Array(Math.max(3, prescanLimit));
  let pendingBytes = 0;
  let encodingPrescanBytes = 0;
  let decoderState: StreamDecoderState | undefined;
  const output = new DecodedOutputCollector(
    budgets?.maxDecodedUtf8Bytes,
    options,
    operation
  );
  const sniffOptions = options.transportEncodingLabel === undefined
    ? { maxPrescanBytes: prescanLimit }
    : { transportEncodingLabel: options.transportEncodingLabel, maxPrescanBytes: prescanLimit };

  const initializeDecoder = (endOfStream: boolean): StreamDecoderState | undefined => {
    const bufferedBytes = pendingBytesBuffer.subarray(0, pendingBytes);
    const decision = decideHtmlEncoding(bufferedBytes, { ...sniffOptions, endOfStream });
    if (decision.status === "pending") return undefined;
    const sniff = decision.result;
    const state = { decoder: new TextDecoder(sniff.encoding), sniff };
    decoderState = state;
    options.onEncodingSniff?.(sniff);
    decodeTransportBytes(state.decoder, bufferedBytes, output, operation);
    return state;
  };

  try {
    for (;;) {
      const next = await readStreamChunk(reader, operation);
      if (next.done) break;
      const chunkValue = next.value;
      if (!(chunkValue instanceof Uint8Array)) {
        throw new HtmlStreamReadError(
          new TypeError("HTML byte stream yielded a non-Uint8Array chunk")
        );
      }
      total += chunkValue.byteLength;
      enforceBudget("maxInputBytes", budgets?.maxInputBytes, total);
      operation.checkpoint();

      if (decoderState === undefined) {
        let offset = 0;
        while (offset < chunkValue.byteLength) {
          const capacity = pendingBytesBuffer.byteLength - pendingBytes;
          if (capacity === 0) {
            const initialized = initializeDecoder(false);
            if (initialized === undefined) {
              failInternalState("ENCODING_SNIFF_BOUNDED_PREFIX_UNDECIDED");
            }
            break;
          }
          let bytesToBuffer = Math.min(chunkValue.byteLength - offset, capacity);
          if (pendingBytes < 3) {
            bytesToBuffer = 1;
          } else {
            const nextTagEnd = chunkValue.indexOf(0x3e, offset);
            if (nextTagEnd !== -1) {
              bytesToBuffer = Math.min(bytesToBuffer, nextTagEnd - offset + 1);
            }
          }
          pendingBytesBuffer.set(
            chunkValue.subarray(offset, offset + bytesToBuffer),
            pendingBytes
          );
          pendingBytes += bytesToBuffer;
          offset += bytesToBuffer;
          encodingPrescanBytes = Math.max(
            encodingPrescanBytes,
            Math.min(pendingBytes, prescanLimit)
          );
          const lastBufferedByte = pendingBytesBuffer[pendingBytes - 1];
          const initialized = pendingBytes <= 3 || lastBufferedByte === 0x3e ||
              pendingBytes === pendingBytesBuffer.byteLength
            ? initializeDecoder(false)
            : undefined;
          if (initialized !== undefined) break;
        }
        const initializedDecoder = decoderState as StreamDecoderState | undefined;
        if (initializedDecoder !== undefined && offset < chunkValue.byteLength) {
          decodeTransportBytes(
            initializedDecoder.decoder,
            chunkValue.subarray(offset),
            output,
            operation
          );
        }
        continue;
      }
      decodeTransportBytes(decoderState.decoder, chunkValue, output, operation);
    }

    const finalState = decoderState ?? initializeDecoder(true);
    if (finalState === undefined) {
      failInternalState("ENCODING_SNIFF_EOF_UNDECIDED");
    }
    output.append(finalState.decoder.decode());
    return Object.freeze({
      text: output.text(),
      sniff: finalState.sniff,
      totalBytes: total,
      decodedUtf8Bytes: output.bytes,
      decodedCodeUnits: output.codeUnits,
      encodingPrescanBytes,
      encodingPrescanLimitBytes: prescanLimit
    });
  } catch (error) {
    try {
      const cancellation = reader.cancel(error);
      void cancellation.catch(() => undefined);
    } catch {
      // Cleanup never replaces the original operation failure.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
