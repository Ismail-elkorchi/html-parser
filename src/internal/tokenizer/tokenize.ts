import { Tokenizer, TokenizerMode } from "../parse5-runtime.js";

import type {
  HtmlToken,
  TokenizeOptions,
  TokenizeResult,
  TokenizerDebugSnapshot,
  TokenizerInitialState,
  TokenizerParseError,
  TokenizerState
} from "./tokens.js";

const INITIAL_STATE_MODE: Record<TokenizerInitialState, number> = {
  "Data state": TokenizerMode.DATA,
  "RCDATA state": TokenizerMode.RCDATA,
  "RAWTEXT state": TokenizerMode.RAWTEXT,
  "Script data state": TokenizerMode.SCRIPT_DATA,
  "PLAINTEXT state": TokenizerMode.PLAINTEXT,
  "CDATA section state": TokenizerMode.CDATA_SECTION
};

function getInitialState(options: TokenizeOptions): TokenizerInitialState {
  return options.initialState ?? "Data state";
}

function mergeAdjacentCharacterTokens(tokens: readonly HtmlToken[]): HtmlToken[] {
  const merged: HtmlToken[] = [];

  for (const token of tokens) {
    const previous = merged[merged.length - 1];
    if (token.type === "Character" && previous?.type === "Character") {
      merged[merged.length - 1] = {
        type: "Character",
        data: previous.data + token.data
      };
      continue;
    }

    merged.push(token);
  }

  return merged;
}

function enforceBudgets(tokens: readonly HtmlToken[], errors: TokenizerParseError[], options: TokenizeOptions): void {
  const maxTextBytes = options.budgets?.maxTextBytes;
  if (maxTextBytes !== undefined) {
    const textBytes = tokens
      .filter((token) => token.type === "Character")
      .reduce((total, token) => total + token.data.length, 0);

    if (textBytes > maxTextBytes) {
      errors.push({ code: "max-text-bytes-exceeded", index: textBytes });
    }
  }

  const maxTokenBytes = options.budgets?.maxTokenBytes;
  if (maxTokenBytes !== undefined) {
    for (const token of tokens) {
      if (JSON.stringify(token).length > maxTokenBytes) {
        errors.push({ code: "max-token-bytes-exceeded", index: 0 });
        break;
      }
    }
  }
}

function createDebugSnapshot(
  input: string,
  tokens: readonly HtmlToken[],
  options: TokenizeOptions
): TokenizerDebugSnapshot | undefined {
  if (!options.debug?.enabled) {
    return undefined;
  }

  const windowCodePoints = options.debug.windowCodePoints ?? 32;
  const inputWindow = input.slice(0, windowCodePoints * 2);
  const lastTokens = tokens.slice(Math.max(0, tokens.length - (options.debug.lastTokens ?? 5)));

  const currentStateMap: Record<TokenizerInitialState, TokenizerState> = {
    "Data state": "Data",
    "RCDATA state": "Data",
    "RAWTEXT state": "Data",
    "Script data state": "Data",
    "PLAINTEXT state": "Data",
    "CDATA section state": "Data"
  };

  return {
    currentState: currentStateMap[getInitialState(options)],
    inputWindow,
    lastTokens
  };
}

function tokenizeWithParse5(input: string, options: TokenizeOptions): TokenizeResult {
  options.checkpoint?.();
  const tokens: HtmlToken[] = [];
  const errors: TokenizerParseError[] = [];

  const parser = new Tokenizer(
    {
      sourceCodeLocationInfo: false,
      ...(options.checkpoint ? { onProgress: options.checkpoint } : {}),
      ...(options.onStartTagOpen ? { onStartTagOpen: options.onStartTagOpen } : {}),
      ...(options.onStartTagAttribute
        ? { onStartTagAttribute: options.onStartTagAttribute }
        : {})
    },
    {
      onStartTag(token) {
        options.checkpoint?.();
        options.onStartTag?.(token.attrs);
        const attrs: Record<string, string> = {};
        for (const attr of token.attrs) {
          if (attrs[attr.name] === undefined) {
            attrs[attr.name] = attr.value;
          }
        }

        tokens.push({
          type: "StartTag",
          name: token.tagName,
          attributes: Object.freeze(attrs),
          selfClosing: token.selfClosing
        });
      },
      onEndTag(token) {
        options.checkpoint?.();
        tokens.push({
          type: "EndTag",
          name: token.tagName
        });
      },
      onComment(token) {
        options.checkpoint?.();
        tokens.push({
          type: "Comment",
          data: token.data
        });
      },
      onDoctype(token) {
        options.checkpoint?.();
        tokens.push({
          type: "Doctype",
          name: token.name ?? "",
          publicId: token.publicId ?? null,
          systemId: token.systemId ?? null,
          forceQuirks: token.forceQuirks
        });
      },
      onCharacter(token) {
        options.checkpoint?.();
        tokens.push({
          type: "Character",
          data: token.chars
        });
      },
      onWhitespaceCharacter(token) {
        options.checkpoint?.();
        tokens.push({
          type: "Character",
          data: token.chars
        });
      },
      onNullCharacter(token) {
        options.checkpoint?.();
        tokens.push({
          type: "Character",
          data: token.chars
        });
      },
      onParseError(error: { readonly code: string; readonly startOffset: number }) {
        options.checkpoint?.();
        options.onParseError?.(errors.length + 1);
        const maxParseErrors = options.budgets?.maxParseErrors;
        if (maxParseErrors !== undefined && errors.length >= maxParseErrors) {
          return;
        }

        errors.push({
          code: error.code,
          index: error.startOffset
        });
      },
      onEof() {
        options.checkpoint?.();
      }
    }
  );

  const initialState = getInitialState(options);
  parser.state = INITIAL_STATE_MODE[initialState];
  parser.lastStartTagName = (options.lastStartTag ?? "").toLowerCase();

  if (initialState === "CDATA section state") {
    parser.inForeignNode = true;
  }

  parser.write(input, true);

  const mergedTokens = mergeAdjacentCharacterTokens(tokens);

  enforceBudgets(mergedTokens, errors, options);

  const debug = createDebugSnapshot(input, mergedTokens, options);

  return {
    tokens: [...mergedTokens, { type: "EOF" }],
    errors,
    ...(debug ? { debug } : {})
  };
}

export function tokenize(input: string, options: TokenizeOptions = {}): TokenizeResult {
  return tokenizeWithParse5(input, options);
}
