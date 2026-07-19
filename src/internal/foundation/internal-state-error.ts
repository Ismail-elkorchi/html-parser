const INTERNAL_STATE_COMPONENT_BY_REASON = Object.freeze({
  CHARACTER_REFERENCE_ASCII_CONSUMPTION_MISMATCH: "character-reference-consumer",
  FOUNDATION_CURSOR_REQUESTED_MORE_AFTER_CLOSE: "foundation-driver",
  GENERATED_CHARACTER_REFERENCE_ENTRY_MISSING: "named-character-references",
  GENERATED_CHARACTER_REFERENCE_LENGTH_MISMATCH: "named-character-references",
  INPUT_CURSOR_BUFFER_UNDERRUN: "input-cursor",
  PUBLIC_TREE_CHILD_CONVERSION_MISSING: "public-tree-conversion",
  PUBLIC_TREE_ROOT_CONVERSION_MISSING: "public-tree-conversion",
  TOKENIZER_BUFFERED_CHARACTER_MISSING: "tokenizer",
  TOKENIZER_CDATA_BRACKET_POSITION_MISSING: "tokenizer",
  TOKENIZER_CHARACTER_REFERENCE_MISSING: "tokenizer",
  TOKENIZER_CURRENT_ATTRIBUTE_MISSING: "token-builder",
  TOKENIZER_CURRENT_COMMENT_MISSING: "tokenizer",
  TOKENIZER_CURRENT_DOCTYPE_MISSING: "tokenizer",
  TOKENIZER_CURRENT_PROCESSING_INSTRUCTION_MISSING: "tokenizer",
  TOKENIZER_CURRENT_TAG_MISSING: "tokenizer",
  TOKENIZER_DOCTYPE_NAME_MISSING: "token-builder",
  TOKENIZER_DOCTYPE_PUBLIC_IDENTIFIER_MISSING: "token-builder",
  TOKENIZER_DOCTYPE_SYSTEM_IDENTIFIER_MISSING: "token-builder",
  TOKENIZER_LESS_THAN_SPAN_MISSING: "tokenizer",
  TOKENIZER_LOOKAHEAD_CONSUMPTION_MISMATCH: "tokenizer",
  TOKENIZER_STATE_UNREACHABLE: "tokenizer",
  TREE_ADAPTER_CHILD_CONVERSION_MISSING: "tree-adapter",
  TREE_ADAPTER_LEAF_KIND_UNREACHABLE: "tree-adapter",
  TREE_ADAPTER_ROOT_CONVERSION_MISSING: "tree-adapter",
  TREE_SERIALIZER_DOCTYPE_IDENTIFIER_UNREPRESENTABLE: "tree-serializer"
} as const);

/** Machine-readable causes of contradictions in private parser state. */
export type InternalStateErrorReason = keyof typeof INTERNAL_STATE_COMPONENT_BY_REASON;

/** Private subsystem in which an internal-state contradiction was detected. */
export type InternalStateComponent =
  (typeof INTERNAL_STATE_COMPONENT_BY_REASON)[InternalStateErrorReason];

/** A library defect or corrupted private state, never a recoverable input error. */
export class InternalStateError extends Error {
  readonly code = "HTML_INTERNAL_STATE_ERROR";
  readonly component: InternalStateComponent;
  readonly reason: InternalStateErrorReason;

  constructor(reason: InternalStateErrorReason) {
    const component = INTERNAL_STATE_COMPONENT_BY_REASON[reason];
    super(`HTML parser internal state failure: ${reason}`);
    this.name = "InternalStateError";
    this.component = component;
    this.reason = reason;
    Object.freeze(this);
  }
}

/** Stops execution at an internal contradiction with a structured cause. */
export function failInternalState(reason: InternalStateErrorReason): never {
  throw new InternalStateError(reason);
}

/** Narrows a private value whose absence contradicts the owning state. */
export function requireInternalValue<T>(
  value: T | null | undefined,
  reason: InternalStateErrorReason
): T {
  if (value === null || value === undefined) failInternalState(reason);
  return value;
}

/** Preserves a defensive runtime failure while requiring compile-time exhaustiveness. */
export function unreachableInternalState(
  value: never,
  reason: InternalStateErrorReason
): never {
  void value;
  return failInternalState(reason);
}
