import {
  runEngineFoundationDriver,
  type HtmlToken,
  type InsertionMode,
  type TokenizerMode
} from "../../src/internal/html-engine/mod.js";
import * as PublicApi from "../../src/mod.js";

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
void tokenizerMode;
void insertionMode;

runEngineFoundationDriver({
  inputChunks: ["<p>x"],
  parser: { kind: "document", scriptingMode: "inert" }
});

// @ts-expect-error - the tokenizer mode vocabulary is closed.
const invalidTokenizerMode: TokenizerMode = "script";
void invalidTokenizerMode;

// @ts-expect-error - the insertion mode vocabulary is closed.
const invalidInsertionMode: InsertionMode = "body";
void invalidInsertionMode;

// @ts-expect-error - the non-executing driver cannot select a script-executing mode.
runEngineFoundationDriver({ inputChunks: [], parser: { kind: "document", scriptingMode: "normal" } });

// @ts-expect-error - fragment parsing requires an explicit context identity.
runEngineFoundationDriver({ inputChunks: [], parser: { kind: "fragment", scriptingMode: "inert" } });

// @ts-expect-error - tokens are immutable once emitted.
token.name = "svg";

// @ts-expect-error - the incomplete driver is not part of the public package surface.
void PublicApi.runEngineFoundationDriver;
