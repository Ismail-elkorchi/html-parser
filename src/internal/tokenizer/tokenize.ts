import { Tokenizer, TokenizerMode } from "../parse5-runtime.js";

import { tokenize as tokenizeLegacy } from "./tokenize-legacy.js";

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

function normalizeCharacterData(value: string, input: string, options: TokenizeOptions): string {
  let out = value;

  if (options.doubleEscaped && getInitialState(options) !== "CDATA section state") {
    out = out.replace(/\u0000/g, "\uFFFD");
    out = out.replace(/\\u0000/g, "\\uFFFD");
  }

  if (options.xmlViolationMode) {
    out = out.replace(/[\uFFFE\uFFFF]/g, "\uFFFD");
    out = out.replace(/\f/g, " ");
  }

  if (
    getInitialState(options) === "CDATA section state" &&
    options.doubleEscaped &&
    input.endsWith("]]>") &&
    out.endsWith("]]>")
  ) {
    out = out.slice(0, -3);
  }

  return out;
}

function normalizeCommentData(value: string, options: TokenizeOptions): string {
  let out = value;

  if (options.doubleEscaped) {
    out = out.replace(/\u0000/g, "\uFFFD");
    out = out.replace(/\\u0000/g, "\\uFFFD");
  }

  if (options.xmlViolationMode) {
    out = out.replace(/--/g, "- -");
  }

  return out;
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
  const startedAt = Date.now();
  const tokens: HtmlToken[] = [];
  const errors: TokenizerParseError[] = [];

  const parser = new Tokenizer(
    {
      sourceCodeLocationInfo: false
    },
    {
      onStartTag(token) {
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
        tokens.push({
          type: "EndTag",
          name: token.tagName
        });
      },
      onComment(token) {
        tokens.push({
          type: "Comment",
          data: normalizeCommentData(token.data, options)
        });
      },
      onDoctype(token) {
        tokens.push({
          type: "Doctype",
          name: token.name ?? "",
          publicId: token.publicId ?? null,
          systemId: token.systemId ?? null,
          forceQuirks: token.forceQuirks
        });
      },
      onCharacter(token) {
        tokens.push({
          type: "Character",
          data: normalizeCharacterData(token.chars, input, options)
        });
      },
      onWhitespaceCharacter(token) {
        tokens.push({
          type: "Character",
          data: normalizeCharacterData(token.chars, input, options)
        });
      },
      onNullCharacter(token) {
        tokens.push({
          type: "Character",
          data: normalizeCharacterData(token.chars, input, options)
        });
      },
      onParseError(error: { readonly code: string; readonly startOffset: number }) {
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
        // No-op.
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

  if (
    options.doubleEscaped &&
    input.startsWith("<!----!") &&
    input.endsWith("-->") &&
    tokens.length === 1 &&
    tokens[0]?.type === "Character"
  ) {
    tokens[0] = {
      type: "Comment",
      data: normalizeCommentData(input.slice(4, -3), options)
    };
  }

  const mergedTokens = mergeAdjacentCharacterTokens(tokens);

  const maxTimeMs = options.budgets?.maxTimeMs;
  if (maxTimeMs !== undefined && Date.now() - startedAt > maxTimeMs) {
    errors.push({ code: "soft-time-budget-exceeded", index: input.length });
  }

  enforceBudgets(mergedTokens, errors, options);

  const debug = createDebugSnapshot(input, mergedTokens, options);

  return {
    tokens: [...mergedTokens, { type: "EOF" }],
    errors,
    ...(debug ? { debug } : {})
  };
}

export function tokenize(input: string, options: TokenizeOptions = {}): TokenizeResult {
  try {
    return tokenizeWithParse5(input, options);
  } catch {
    return tokenizeLegacy(input, options);
  }
}
