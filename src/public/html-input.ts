import { sniffHtmlEncoding } from "../internal/encoding/sniff.ts";

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
  readonly text: string;
  readonly sniff: StreamEncodingSniff;
  readonly totalBytes: number;
  readonly decodedUtf8Bytes: number;
  readonly encodingPrescanBytes: number;
  readonly encodingPrescanLimitBytes: number;
}

interface StreamDecoderState {
  readonly decoder: TextDecoder;
  readonly sniff: StreamEncodingSniff;
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
export async function decodeStreamToText(
  stream: ReadableStream<Uint8Array>,
  options: {
    readonly transportEncodingLabel?: string;
    readonly budgets?: ParseStreamBudgetOptions | TokenizeByteStreamEagerOptions["budgets"];
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
  const pendingBytesBuffer = new Uint8Array(prescanLimit);
  let pendingBytes = 0;
  let encodingPrescanBytes = 0;
  let decoderState: StreamDecoderState | undefined;
  const decodedParts: string[] = [];
  const decodedBudget = new DecodedUtf8BudgetCounter(
    budgets?.maxDecodedUtf8Bytes,
    operation
  );
  const sniffOptions = options.transportEncodingLabel === undefined
    ? { maxPrescanBytes: prescanLimit }
    : { transportEncodingLabel: options.transportEncodingLabel, maxPrescanBytes: prescanLimit };

  const appendDecoded = (value: string): void => {
    if (value.length > 0) {
      decodedBudget.append(value);
      decodedParts.push(value);
    }
  };
  const decodeBytes = (decoder: TextDecoder, bytes: Uint8Array): void => {
    const decodeChunkBytes = 16_384;
    for (let offset = 0; offset < bytes.byteLength; offset += decodeChunkBytes) {
      operation.checkpoint();
      appendDecoded(decoder.decode(bytes.subarray(offset, offset + decodeChunkBytes), { stream: true }));
    }
  };
  const initializeDecoder = (): StreamDecoderState => {
    const bufferedBytes = pendingBytesBuffer.subarray(0, pendingBytes);
    const sniff = sniffHtmlEncoding(bufferedBytes, sniffOptions);
    const state = { decoder: new TextDecoder(sniff.encoding), sniff };
    decoderState = state;
    decodeBytes(state.decoder, bufferedBytes);
    return state;
  };

  try {
    if (prescanLimit === 0) initializeDecoder();
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
        const bytesToBuffer = Math.min(chunkValue.byteLength, prescanLimit - pendingBytes);
        pendingBytesBuffer.set(chunkValue.subarray(0, bytesToBuffer), pendingBytes);
        pendingBytes += bytesToBuffer;
        encodingPrescanBytes = Math.max(encodingPrescanBytes, pendingBytes);
        if (pendingBytes < prescanLimit) continue;
        const activeDecoder = initializeDecoder().decoder;
        if (bytesToBuffer < chunkValue.byteLength) {
          decodeBytes(activeDecoder, chunkValue.subarray(bytesToBuffer));
        }
        continue;
      }
      decodeBytes(decoderState.decoder, chunkValue);
    }

    const finalState = decoderState ?? initializeDecoder();
    appendDecoded(finalState.decoder.decode());
    return {
      text: decodedParts.join(""),
      sniff: finalState.sniff,
      totalBytes: total,
      decodedUtf8Bytes: decodedBudget.bytes,
      encodingPrescanBytes,
      encodingPrescanLimitBytes: prescanLimit
    };
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
