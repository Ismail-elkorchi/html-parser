import {
  HtmlTokenizer,
  createEngineResourceGuard,
  type HtmlTokenizerRunResult,
  type HtmlTokenizerState
} from "../../../src/internal/html-engine/mod.js";
import * as PublicApi from "../../../src/mod.js";

const tokenizer = new HtmlTokenizer(
  createEngineResourceGuard(),
  {
    accept(token) {
      const kind: typeof token.kind = token.kind;
      void kind;
      // @ts-expect-error emitted tokens are immutable
      token.kind = "eof";
      return { selfClosingAcknowledged: true };
    }
  },
  { initialState: "rcdata", lastStartTagName: "title", foreignContent: false }
);

const result: HtmlTokenizerRunResult = tokenizer.write("text");
if (result.status === "need-more-input") {
  const state: HtmlTokenizerState = result.state;
  void state;
} else {
  const offset: number = result.position.utf16Offset;
  void offset;
}

tokenizer.setMode("plaintext");
tokenizer.setLastStartTagName(null);
tokenizer.setForeignContent(true);

// @ts-expect-error tokenizer modes form a closed union
tokenizer.setMode("text");

// @ts-expect-error direct CDATA entry is not a tree-builder tokenizer mode
tokenizer.setMode("cdata-section");

new HtmlTokenizer(
  createEngineResourceGuard(),
  { accept: () => ({ selfClosingAcknowledged: true }) },
  {
    // @ts-expect-error the constructor uses the exact initial-state option, not a legacy mode alias
    mode: "data"
  }
);

// @ts-expect-error state names retain exact standard-anchor spelling
const invalidState: HtmlTokenizerState = "data";
void invalidState;

// @ts-expect-error the incomplete tokenizer is not part of the public package surface
void PublicApi.HtmlTokenizer;
