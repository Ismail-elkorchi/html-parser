import { runHtmlEngine } from "../../../src/internal/html-engine/parser-driver.js";
import * as PublicApi from "../../../src/mod.js";

import type { HtmlParseErrorCode } from "../../../src/internal/html-engine/diagnostics.js";
import type { InsertionMode, TokenizerMode } from "../../../src/internal/html-engine/parser-state.js";
import type { HtmlToken } from "../../../src/internal/html-engine/tokens.js";

const token: HtmlToken = {
  kind: "doctype",
  name: "html",
  publicIdentifier: null,
  systemIdentifier: "",
  forceQuirks: false,
  span: { startUtf16Offset: 0, endUtf16Offset: 15 }
};

function assertNever(value: never): never {
  throw new Error(`Unexpected token: ${JSON.stringify(value)}`);
}

function tokenKind(value: HtmlToken): HtmlToken["kind"] {
  switch (value.kind) {
    case "doctype":
    case "start-tag":
    case "end-tag":
    case "comment":
    case "processing-instruction":
    case "character":
    case "eof":
      return value.kind;
    default:
      return assertNever(value);
  }
}

tokenKind(token);

const tokenizerMode: TokenizerMode = "script-data";
const insertionMode: InsertionMode = "in-table-text";
const parseErrorCode: HtmlParseErrorCode = "eof-in-processing-instruction";
void tokenizerMode;
void insertionMode;
void parseErrorCode;

runHtmlEngine({
  inputChunks: ["<p>x"],
  parser: { kind: "document", scriptingMode: "inert" }
});

runHtmlEngine({
  inputChunks: ["<b>x"],
  parser: {
    kind: "fragment",
    scriptingMode: "disabled",
    context: {
      namespaceUri: "http://www.w3.org/1999/xhtml",
      localName: "div",
      attributes: []
    }
  }
});

// @ts-expect-error - the tokenizer mode vocabulary is closed.
const invalidTokenizerMode: TokenizerMode = "script";
void invalidTokenizerMode;

// @ts-expect-error - the insertion mode vocabulary is closed.
const invalidInsertionMode: InsertionMode = "body";
void invalidInsertionMode;

// @ts-expect-error - parse-error names retain exact standard spelling.
const invalidParseErrorCode: HtmlParseErrorCode = "eof-processing-instruction";
void invalidParseErrorCode;

// @ts-expect-error - the non-executing driver cannot select a script-executing mode.
runHtmlEngine({ inputChunks: [], parser: { kind: "document", scriptingMode: "normal" } });

// @ts-expect-error - fragment parsing requires an explicit namespace-aware context.
runHtmlEngine({ inputChunks: [], parser: { kind: "fragment", scriptingMode: "inert" } });

// @ts-expect-error - tokens are immutable once emitted.
token.name = "svg";

// @ts-expect-error - the private engine driver is not part of the public package surface.
void PublicApi.runHtmlEngine;
