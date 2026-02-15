// Vendored parse5 runtime entrypoint with serializer-free surface.
// Runtime modules are copied into dist by scripts/build/copy-vendor.mjs.
// @ts-expect-error Vendored JS module does not include local .d.ts in this repository.
import { Parser as RawParser } from "./vendor/parse5/parser/index.js";
// @ts-expect-error Vendored JS module does not include local .d.ts in this repository.
import { Tokenizer as RawTokenizer, TokenizerMode as RawTokenizerMode } from "./vendor/parse5/tokenizer/index.js";

type ParseOptions = {
  readonly scriptingEnabled?: boolean;
  readonly sourceCodeLocationInfo?: boolean;
  readonly onParseError?: (error: { readonly code: string; readonly startOffset: number }) => void;
};

type ParserFacade = {
  parse(html: string, options?: ParseOptions): unknown;
  getFragmentParser(
    fragmentContext: unknown,
    options?: ParseOptions
  ): {
    tokenizer: {
      write(input: string, isLastChunk: boolean): void;
    };
    getFragment(): unknown;
  };
};

type Parse5TokenizerMode = {
  readonly DATA: number;
  readonly RCDATA: number;
  readonly RAWTEXT: number;
  readonly SCRIPT_DATA: number;
  readonly PLAINTEXT: number;
  readonly CDATA_SECTION: number;
};

type Parse5TokenizerAttribute = {
  readonly name: string;
  readonly value: string;
};

type Parse5StartTagToken = {
  readonly tagName: string;
  readonly attrs: readonly Parse5TokenizerAttribute[];
  readonly selfClosing: boolean;
};

type Parse5EndTagToken = {
  readonly tagName: string;
};

type Parse5CommentToken = {
  readonly data: string;
};

type Parse5DoctypeToken = {
  readonly name?: string | null;
  readonly publicId?: string | null;
  readonly systemId?: string | null;
  readonly forceQuirks: boolean;
};

type Parse5CharacterToken = {
  readonly chars: string;
};

type Parse5ParseError = {
  readonly code: string;
  readonly startOffset: number;
};

type Parse5TokenizerHandlers = {
  onStartTag(token: Parse5StartTagToken): void;
  onEndTag(token: Parse5EndTagToken): void;
  onComment(token: Parse5CommentToken): void;
  onDoctype(token: Parse5DoctypeToken): void;
  onCharacter(token: Parse5CharacterToken): void;
  onWhitespaceCharacter(token: Parse5CharacterToken): void;
  onNullCharacter(token: Parse5CharacterToken): void;
  onParseError(error: Parse5ParseError): void;
  onEof(): void;
};

export type Parse5Tokenizer = {
  state: number;
  lastStartTagName: string;
  inForeignNode: boolean;
  write(input: string, isLastChunk: boolean): void;
};

type Parse5TokenizerConstructor = new (
  options: { readonly sourceCodeLocationInfo: boolean },
  handlers: Parse5TokenizerHandlers
) => Parse5Tokenizer;

const Parser = RawParser as ParserFacade;

export const Tokenizer = RawTokenizer as Parse5TokenizerConstructor;
export const TokenizerMode = RawTokenizerMode as Parse5TokenizerMode;

export function parse(html: string, options?: ParseOptions): unknown {
  return Parser.parse(html, options);
}

export function parseFragment(fragmentContext: string, options?: ParseOptions): unknown;
export function parseFragment(fragmentContext: unknown, html: string, options?: ParseOptions): unknown;
export function parseFragment(
  fragmentContextOrHtml: unknown,
  htmlOrOptions?: string | ParseOptions,
  options?: ParseOptions
): unknown {
  if (typeof fragmentContextOrHtml === "string") {
    const parser = Parser.getFragmentParser(null, htmlOrOptions as ParseOptions | undefined);
    parser.tokenizer.write(fragmentContextOrHtml, true);
    return parser.getFragment();
  }

  const parser = Parser.getFragmentParser(fragmentContextOrHtml, options);
  parser.tokenizer.write(typeof htmlOrOptions === "string" ? htmlOrOptions : "", true);
  return parser.getFragment();
}
