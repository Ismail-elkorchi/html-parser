/** A zero-based position in decoded input, measured in UTF-16 code units. */
export interface SourcePosition {
  readonly utf16Offset: number;
}

/** A half-open range in decoded input, measured in UTF-16 code units. */
export interface SourceSpan {
  readonly startUtf16Offset: number;
  readonly endUtf16Offset: number;
}

/** Creates a decoded-input position whose fields are read-only to engine consumers. */
export function sourcePosition(utf16Offset: number): SourcePosition {
  return { utf16Offset };
}

/** Creates a decoded-input span whose fields are read-only to engine consumers. */
export function sourceSpan(startUtf16Offset: number, endUtf16Offset: number): SourceSpan {
  return { startUtf16Offset, endUtf16Offset };
}
