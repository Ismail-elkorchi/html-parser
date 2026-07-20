import {
  HtmlTokenizer,
  createEngineResourceGuard
} from "../../dist/internal/html-engine/mod.js";

function initialState(value) {
  switch (value ?? "Data state") {
    case "Data state": return "data";
    case "RCDATA state": return "rcdata";
    case "RAWTEXT state": return "rawtext";
    case "Script data state": return "script-data";
    case "PLAINTEXT state": return "plaintext";
    case "CDATA section state": return "cdata-section";
    default: throw new Error(`Unknown tokenizer fixture initial state: ${String(value)}`);
  }
}

function normalizeCharacterData(value, input, options) {
  let normalized = value;
  if (options.doubleEscaped && options.initialState !== "CDATA section state") {
    normalized = normalized.split("\0").join("\uFFFD");
    normalized = normalized.replace(/\\u0000/g, "\\uFFFD");
  }
  if (options.xmlViolationMode) {
    normalized = normalized.replace(/[\uFFFE\uFFFF]/g, "\uFFFD");
    normalized = normalized.replace(/\f/g, " ");
  }
  if (
    options.initialState === "CDATA section state" &&
    options.doubleEscaped &&
    input.endsWith("]]>") &&
    normalized.endsWith("]]>")
  ) {
    normalized = normalized.slice(0, -3);
  }
  return normalized;
}

function normalizeCommentData(value, options) {
  let normalized = value;
  if (options.doubleEscaped) {
    normalized = normalized.split("\0").join("\uFFFD");
    normalized = normalized.replace(/\\u0000/g, "\\uFFFD");
  }
  if (options.xmlViolationMode) normalized = normalized.replace(/--/g, "- -");
  return normalized;
}

function fixtureToken(token, input, options) {
  switch (token.kind) {
    case "character":
      return { type: "Character", data: normalizeCharacterData(token.data, input, options) };
    case "comment":
      return { type: "Comment", data: normalizeCommentData(token.data, options) };
    case "processing-instruction":
      return { type: "ProcessingInstruction", target: token.target, data: token.data };
    case "start-tag": {
      const attributes = {};
      for (const attribute of token.attributes) attributes[attribute.name] = attribute.value;
      return { type: "StartTag", name: token.name, attributes, selfClosing: token.selfClosing };
    }
    case "end-tag": return { type: "EndTag", name: token.name };
    case "doctype": {
      return {
        type: "Doctype",
        name: token.name,
        publicId: token.publicIdentifier,
        systemId: token.systemIdentifier,
        forceQuirks: token.forceQuirks
      };
    }
    case "eof": return { type: "EOF" };
  }
}

/** Applies html5lib fixture conventions around the production tokenizer. */
export function tokenizeFixtureCase(input, options = {}) {
  const tokens = [];
  const errors = [];
  const guard = createEngineResourceGuard({
    limits: {
      maxSteps: 1_000_000,
      maxAttributesPerElement: options.budgets?.maxAttributesPerElement ?? 10_000,
      maxAttributeUtf8BytesPerElement: options.budgets?.maxTokenBytes ?? 1_000_000,
      maxParseErrors: options.budgets?.maxParseErrors ?? 10_000,
      ...(options.budgets?.maxTimeMs === undefined
        ? {}
        : { maxTimeMs: options.budgets.maxTimeMs })
    }
  });
  const tokenizer = new HtmlTokenizer(
    guard,
    {
      accept(token) {
        const converted = fixtureToken(token, input, options);
        const previous = tokens.at(-1);
        if (converted.type === "Character" && previous?.type === "Character") {
          previous.data += converted.data;
        } else {
          tokens.push(converted);
        }
        return true;
      }
    },
    {
      initialState: initialState(options.initialState),
      lastStartTagName: options.lastStartTag ?? null,
      observer: { onParseError: (error) => errors.push(error) }
    }
  );
  tokenizer.write(input);
  tokenizer.close();
  return {
    tokens,
    errors,
    resources: guard.snapshot()
  };
}
