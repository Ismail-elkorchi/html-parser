import {
  parse as parseInternal,
  parseBytes as parseBytesInternal,
  parseFragment as parseFragmentInternal,
  parseStream as parseStreamInternal,
  serialize as serializeInternal,
  tokenizeStream as tokenizeStreamInternal,
  visibleText as visibleTextInternal
} from "../src/public/mod.ts";

/**
 * Parse a full HTML document into a deterministic tree.
 */
export function parse(input: string, options?: Record<string, unknown>): unknown {
  return parseInternal(input, options as Parameters<typeof parseInternal>[1]);
}

/**
 * Parse encoded HTML bytes after encoding sniffing.
 */
export function parseBytes(input: Uint8Array, options?: Record<string, unknown>): unknown {
  return parseBytesInternal(input, options as Parameters<typeof parseBytesInternal>[1]);
}

/**
 * Parse markup relative to a fragment context tag.
 */
export function parseFragment(
  html: string,
  contextTagName: string,
  options?: Record<string, unknown>
): unknown {
  return parseFragmentInternal(
    html,
    contextTagName,
    options as Parameters<typeof parseFragmentInternal>[2]
  );
}

/**
 * Parse HTML from a byte stream.
 */
export async function parseStream(
  input: ReadableStream<Uint8Array>,
  options?: Record<string, unknown>
): Promise<unknown> {
  return parseStreamInternal(input, options as Parameters<typeof parseStreamInternal>[1]);
}

/**
 * Serialize a parsed tree back to HTML.
 */
export function serialize(input: unknown): string {
  return serializeInternal(input as Parameters<typeof serializeInternal>[0]);
}

/**
 * Extract visible text from a parsed tree.
 */
export function visibleText(input: unknown, options?: Record<string, unknown>): string {
  return visibleTextInternal(
    input as Parameters<typeof visibleTextInternal>[0],
    options as Parameters<typeof visibleTextInternal>[1]
  );
}

/**
 * Tokenize HTML from a byte stream.
 */
export async function* tokenizeStream(
  input: ReadableStream<Uint8Array>,
  options?: Record<string, unknown>
): AsyncIterableIterator<unknown> {
  for await (const token of tokenizeStreamInternal(
    input,
    options as Parameters<typeof tokenizeStreamInternal>[1]
  )) {
    yield token;
  }
}
