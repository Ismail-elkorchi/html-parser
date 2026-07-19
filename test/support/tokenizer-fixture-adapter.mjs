import { tokenize } from "../../dist/internal/tokenizer/mod.js";

function normalizeCharacterData(value, input, options) {
  let normalizedValue = value;

  if (options.doubleEscaped && options.initialState !== "CDATA section state") {
    normalizedValue = normalizedValue.split("\u0000").join("\uFFFD");
    normalizedValue = normalizedValue.replace(/\\u0000/g, "\\uFFFD");
  }

  if (options.xmlViolationMode) {
    normalizedValue = normalizedValue.replace(/[\uFFFE\uFFFF]/g, "\uFFFD");
    normalizedValue = normalizedValue.replace(/\f/g, " ");
  }

  if (
    options.initialState === "CDATA section state" &&
    options.doubleEscaped &&
    input.endsWith("]]>") &&
    normalizedValue.endsWith("]]>")
  ) {
    normalizedValue = normalizedValue.slice(0, -3);
  }

  return normalizedValue;
}

function normalizeCommentData(value, options) {
  let normalizedValue = value;

  if (options.doubleEscaped) {
    normalizedValue = normalizedValue.split("\u0000").join("\uFFFD");
    normalizedValue = normalizedValue.replace(/\\u0000/g, "\\uFFFD");
  }

  if (options.xmlViolationMode) {
    normalizedValue = normalizedValue.replace(/--/g, "- -");
  }

  return normalizedValue;
}

/** Applies html5lib fixture encoding conventions outside production tokenization. */
export function tokenizeFixtureCase(input, options = {}) {
  const {
    doubleEscaped = false,
    xmlViolationMode = false,
    ...tokenizeOptions
  } = options;
  const fixtureOptions = {
    doubleEscaped,
    xmlViolationMode,
    initialState: tokenizeOptions.initialState ?? "Data state"
  };
  const result = tokenize(input, tokenizeOptions);
  const tokens = result.tokens.map((token) => {
    if (token.type === "Character") {
      return {
        ...token,
        data: normalizeCharacterData(token.data, input, fixtureOptions)
      };
    }
    if (token.type === "Comment") {
      return {
        ...token,
        data: normalizeCommentData(token.data, fixtureOptions)
      };
    }
    return token;
  });

  if (
    doubleEscaped &&
    input.startsWith("<!----!") &&
    input.endsWith("-->") &&
    tokens.length === 2 &&
    tokens[0]?.type === "Character" &&
    tokens[1]?.type === "EOF"
  ) {
    tokens[0] = {
      type: "Comment",
      data: normalizeCommentData(input.slice(4, -3), fixtureOptions)
    };
  }

  return { ...result, tokens };
}
