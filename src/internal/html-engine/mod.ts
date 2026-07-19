export {
  CharacterReferenceConsumer,
  type CharacterReferenceConsumerMetrics,
  type CharacterReferenceConsumerOptions,
  type CharacterReferenceContext,
  type CharacterReferenceLiteral,
  type CharacterReferenceNeedMore,
  type CharacterReferenceResolved,
  type CharacterReferenceResult
} from "./character-reference-consumer.js";
export {
  HTML_PARSE_ERROR_CODES,
  createParseError,
  type EngineParseError,
  type HtmlParseErrorCode,
  type ParseErrorPhase
} from "./diagnostics.js";
export {
  HtmlInputCursor,
  type InputCodeUnit,
  type InputCodeUnitRead,
  type InputCharacter,
  type InputEof,
  type InputNeedMore,
  type InputParseErrorObserver,
  type InputRead
} from "./input-cursor.js";
export {
  LEGACY_NAMED_CHARACTER_REFERENCE_ENTRY_COUNT,
  MAX_NAMED_CHARACTER_REFERENCE_LENGTH,
  NAMED_CHARACTER_REFERENCE_ENTRY_COUNT,
  probeNamedCharacterReference,
  type NamedCharacterReferenceProbe
} from "./named-character-references.js";
export {
  type EngineObserver,
  type InsertionModeTokenContext,
  type InsertionModeTransition,
  type TokenAcceptance,
  type TokenizerControl,
  type TokenSink,
  type TreeMutationKind,
  type TreeMutationObservation
} from "./observer.js";
export {
  INSERTION_MODES,
  PARSER_SCRIPTING_MODES,
  TOKENIZER_MODES,
  type InsertionMode,
  type NonExecutingScriptingMode,
  type ParserScriptingMode,
  type TokenizerMode
} from "./parser-state.js";
export {
  sourcePosition,
  sourceSpan,
  type SourcePosition,
  type SourceSpan
} from "./positions.js";
export {
  createEngineResourceGuard,
  EngineAbortError,
  EngineConfigurationError,
  EngineResourceLimitError,
  type EngineResourceGuard,
  type EngineResourceGuardOptions,
  type EngineResourceLimitName,
  type EngineResourceLimits,
  type EngineResourceUsage,
  type StartTagResourceGuard
} from "./resource-guard.js";
export { ENGINE_STANDARD_BASELINE, HTML_STANDARD_REVISION } from "./standards.js";
export {
  runEngineFoundationDriver,
  type EngineDocumentDriverConfiguration,
  type EngineDriverParserConfiguration,
  type EngineFoundationDriverOptions,
  type EngineFoundationDriverResult,
  type EngineFragmentContext,
  type EngineFragmentDriverConfiguration
} from "./test-driver.js";
export {
  type HtmlCharacterToken,
  type HtmlCommentToken,
  type HtmlDoctypeToken,
  type HtmlEndTagToken,
  type HtmlStartTagToken,
  type HtmlToken,
  type HtmlTokenAttribute
} from "./tokens.js";
