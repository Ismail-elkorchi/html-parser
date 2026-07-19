import {
  MAX_NAMED_CHARACTER_REFERENCE_LENGTH,
  NAMED_CHARACTER_REFERENCE_DATA,
  NAMED_CHARACTER_REFERENCE_ENTRY_COUNT
} from "./generated/named-character-references.js";

/** One bounded binary-search observation over the generated reference table. */
export interface NamedCharacterReferenceProbe {
  readonly value: string | null;
  readonly hasPrefix: boolean;
  readonly comparisons: number;
}

function dataAt(index: number): string {
  const value = NAMED_CHARACTER_REFERENCE_DATA[index];
  if (value === undefined) {
    throw new Error("Generated named character reference table invariant violated");
  }
  return value;
}

function nameAt(entryIndex: number): string {
  return dataAt(entryIndex * 2);
}

if (NAMED_CHARACTER_REFERENCE_DATA.length !== NAMED_CHARACTER_REFERENCE_ENTRY_COUNT * 2) {
  throw new Error("Generated named character reference table has an invalid length");
}

/** Looks up an exact name and whether any generated name starts with it. */
export function probeNamedCharacterReference(name: string): NamedCharacterReferenceProbe {
  if (name.length > MAX_NAMED_CHARACTER_REFERENCE_LENGTH) {
    return Object.freeze({ value: null, hasPrefix: false, comparisons: 0 });
  }

  let lower = 0;
  let upper = NAMED_CHARACTER_REFERENCE_ENTRY_COUNT;
  let comparisons = 0;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const candidate = nameAt(middle);
    comparisons += 1;
    if (candidate < name) lower = middle + 1;
    else upper = middle;
  }

  if (lower >= NAMED_CHARACTER_REFERENCE_ENTRY_COUNT) {
    return Object.freeze({ value: null, hasPrefix: false, comparisons });
  }
  const candidate = nameAt(lower);
  const value = candidate === name ? dataAt(lower * 2 + 1) : null;
  return Object.freeze({ value, hasPrefix: candidate.startsWith(name), comparisons });
}

export {
  LEGACY_NAMED_CHARACTER_REFERENCE_ENTRY_COUNT,
  MAX_NAMED_CHARACTER_REFERENCE_LENGTH,
  NAMED_CHARACTER_REFERENCE_ENTRY_COUNT
} from "./generated/named-character-references.js";
