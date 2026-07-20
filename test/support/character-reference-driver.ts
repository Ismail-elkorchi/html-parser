import {
  CharacterReferenceConsumer,
  type CharacterReferenceConsumerMetrics,
  type CharacterReferenceContext,
  type CharacterReferenceLiteral,
  type CharacterReferenceResolved
} from "../../src/internal/html-engine/character-reference-consumer.js";
import { HtmlInputCursor } from "../../src/internal/html-engine/input-cursor.js";
import {
  createEngineResourceGuard,
  type EngineResourceGuardOptions,
  type EngineResourceUsage
} from "../../src/internal/html-engine/resource-guard.js";

import type { EngineParseError } from "../../src/internal/html-engine/diagnostics.js";

export interface CharacterReferenceDriverOptions {
  readonly context?: CharacterReferenceContext;
  readonly additionalAllowedCharacter?: string | null;
  readonly suffixChunkCodeUnits?: number;
  readonly guard?: EngineResourceGuardOptions;
  readonly onParseError?: (error: EngineParseError) => void;
}

export interface CharacterReferenceDriverResult {
  readonly result: CharacterReferenceLiteral | CharacterReferenceResolved;
  readonly remainder: string;
  readonly rendered: string;
  readonly metrics: CharacterReferenceConsumerMetrics;
  readonly resources: EngineResourceUsage;
}

function consumeExpectedAmpersand(cursor: HtmlInputCursor, ampersandOffset: number): void {
  while (cursor.position().utf16Offset <= ampersandOffset) {
    const read = cursor.consume();
    if (read.kind !== "character") {
      throw new Error("character reference driver: expected buffered input through ampersand");
    }
    if (read.span.startUtf16Offset === ampersandOffset && read.value !== "&") {
      throw new Error("character reference driver: selected offset is not an ampersand");
    }
  }
}

function drainRemainder(cursor: HtmlInputCursor): string {
  let result = "";
  for (;;) {
    const read = cursor.consume();
    if (read.kind === "eof") return result;
    if (read.kind === "need-more-input") {
      throw new Error("character reference driver: cursor remained open after finalization");
    }
    result += read.value;
  }
}

/** Runs one internal character-reference operation without invoking production parsing. */
export function runCharacterReference(
  input: string,
  ampersandOffset = 0,
  options: CharacterReferenceDriverOptions = {}
): CharacterReferenceDriverResult {
  if (input.charCodeAt(ampersandOffset) !== 0x26) {
    throw new Error("character reference driver: input must contain an ampersand at ampersandOffset");
  }
  const suffixChunkCodeUnits = options.suffixChunkCodeUnits ?? Number.POSITIVE_INFINITY;
  if (
    suffixChunkCodeUnits !== Number.POSITIVE_INFINITY &&
    (!Number.isSafeInteger(suffixChunkCodeUnits) || suffixChunkCodeUnits < 1)
  ) {
    throw new Error("character reference driver: suffixChunkCodeUnits must be positive or Infinity");
  }

  const guard = createEngineResourceGuard(options.guard);
  const cursor = new HtmlInputCursor(guard);
  const prefixThroughAmpersand = input.slice(0, ampersandOffset + 1);
  cursor.write(prefixThroughAmpersand);
  consumeExpectedAmpersand(cursor, ampersandOffset);
  const consumer = new CharacterReferenceConsumer(cursor, guard, {
    context: options.context ?? "text",
    ampersandSpan: {
      startUtf16Offset: ampersandOffset,
      endUtf16Offset: ampersandOffset + 1
    },
    ...(options.additionalAllowedCharacter === undefined
      ? {}
      : { additionalAllowedCharacter: options.additionalAllowedCharacter }),
    ...(options.onParseError === undefined ? {} : { onParseError: options.onParseError })
  });

  const suffix = input.slice(ampersandOffset + 1);
  let suffixOffset = 0;
  let completed: CharacterReferenceLiteral | CharacterReferenceResolved | null = null;
  while (suffixOffset < suffix.length) {
    const nextOffset = suffixChunkCodeUnits === Number.POSITIVE_INFINITY
      ? suffix.length
      : Math.min(suffix.length, suffixOffset + suffixChunkCodeUnits);
    cursor.write(suffix.slice(suffixOffset, nextOffset));
    suffixOffset = nextOffset;
    if (completed === null) {
      const step = consumer.step();
      if (step.kind !== "need-more-input") completed = step;
    }
  }
  cursor.close();
  if (completed === null) {
    const step = consumer.step();
    if (step.kind === "need-more-input") {
      throw new Error("character reference driver: closed input still requested more data");
    }
    completed = step;
  }

  const remainder = drainRemainder(cursor);
  return Object.freeze({
    result: completed,
    remainder,
    rendered: `${completed.value}${remainder}`,
    metrics: consumer.metrics(),
    resources: guard.snapshot()
  });
}
