/** A zero-based position in decoded input, measured in UTF-16 code units. */
export interface SourcePosition {
  readonly utf16Offset: number;
}

/** A half-open range in decoded input, measured in UTF-16 code units. */
export interface SourceSpan {
  readonly startUtf16Offset: number;
  readonly endUtf16Offset: number;
}

/** Creates an immutable decoded-input position. */
export function sourcePosition(utf16Offset: number): SourcePosition {
  return Object.freeze({ utf16Offset });
}

/** Creates an immutable decoded-input span. */
export function sourceSpan(startUtf16Offset: number, endUtf16Offset: number): SourceSpan {
  return Object.freeze({ startUtf16Offset, endUtf16Offset });
}
