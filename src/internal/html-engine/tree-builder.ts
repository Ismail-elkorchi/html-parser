import { failInternalState, requireInternalValue } from "../foundation/internal-state-error.js";

import { createTreeBuilderParseError } from "./diagnostics.js";
import { documentModeForDoctype, type HtmlDocumentMode } from "./doctype-mode.js";
import { HTML_NAMESPACE } from "./namespaces.js";
import { OpenElementStack } from "./open-element-stack.js";

import type { EngineParseError } from "./diagnostics.js";
import type {
  EngineObserver,
  TokenAcceptance,
  TokenizerControl,
  TokenSink
} from "./observer.js";
import type { InsertionMode, NonExecutingScriptingMode, TokenizerMode } from "./parser-state.js";
import type { EngineResourceGuard } from "./resource-guard.js";
import type {
  HtmlEndTagToken,
  HtmlCharacterToken,
  HtmlStartTagToken,
  HtmlToken,
  HtmlTokenAttribute
} from "./tokens.js";
import type {
  HtmlTreeAttributeInput,
  HtmlTreeElement,
  HtmlTreeModel,
  HtmlTreeNode,
  HtmlTreeParent
} from "./tree-model.js";

export type HtmlTreeBuilderPendingFeature =
  | "foreign-content"
  | "frameset"
  | "select"
  | "table"
  | "template";

/** Honest staged-engine boundary for algorithms owned by later implementation rows. */
export class HtmlTreeBuilderPendingFeatureError extends Error {
  readonly code = "HTML_TREE_BUILDER_FEATURE_PENDING";
  readonly feature: HtmlTreeBuilderPendingFeature;
  readonly insertionMode: InsertionMode;

  constructor(feature: HtmlTreeBuilderPendingFeature, insertionMode: InsertionMode) {
    super(`HTML tree-construction feature is not implemented: ${feature}`);
    this.name = "HtmlTreeBuilderPendingFeatureError";
    this.feature = feature;
    this.insertionMode = insertionMode;
    Object.freeze(this);
  }
}

export interface HtmlTreeBuilderOptions {
  readonly model: HtmlTreeModel;
  readonly resources: EngineResourceGuard;
  readonly scriptingMode: NonExecutingScriptingMode;
  readonly observer?: EngineObserver;
  readonly onParseError: (error: EngineParseError) => void;
}

export interface HtmlTreeBuilderState {
  readonly insertionMode: InsertionMode;
  readonly originalInsertionMode: InsertionMode | null;
  readonly documentMode: HtmlDocumentMode;
  readonly openElementCount: number;
  readonly activeFormattingEntryCount: number;
  readonly templateInsertionModes: readonly InsertionMode[];
  readonly headElement: HtmlTreeElement | null;
  readonly formElement: HtmlTreeElement | null;
  readonly framesetOk: boolean;
  readonly fosterParenting: boolean;
  readonly finished: boolean;
}

interface ActiveFormattingElementEntry {
  readonly kind: "element";
  readonly element: HtmlTreeElement;
  readonly token: HtmlStartTagToken;
}

interface ActiveFormattingMarker {
  readonly kind: "marker";
}

type ActiveFormattingEntry = ActiveFormattingElementEntry | ActiveFormattingMarker;

const ASCII_WHITESPACE = /^[\t\n\f\r ]+$/u;

const BLOCK_START_TAGS = new Set([
  "address", "article", "aside", "blockquote", "center", "details", "dialog", "dir", "div",
  "dl", "fieldset", "figcaption", "figure", "footer", "header", "hgroup", "main", "menu",
  "nav", "ol", "p", "search", "section", "summary", "ul"
]);

const BLOCK_END_TAGS = new Set([
  "address", "article", "aside", "blockquote", "button", "center", "details", "dialog", "dir",
  "div", "dl", "fieldset", "figcaption", "figure", "footer", "header", "hgroup", "listing",
  "main", "menu", "nav", "ol", "pre", "search", "section", "summary", "ul"
]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const FORMATTING_TAGS = new Set([
  "a", "b", "big", "code", "em", "font", "i", "nobr", "s", "small", "strike", "strong",
  "tt", "u"
]);
const VOID_HEAD_TAGS = new Set(["base", "basefont", "bgsound", "link", "meta"]);
const HEAD_BODY_DELEGATE_TAGS = new Set(["base", "basefont", "bgsound", "link", "meta", "noframes", "script", "style", "template", "title"]);
const ROOT_IMPLYING_END_TAGS = new Set(["head", "body", "html", "br"]);
const AFTER_HEAD_IMPLYING_END_TAGS = new Set(["body", "html", "br"]);
const HEAD_NOSCRIPT_DELEGATE_TAGS = new Set([
  "basefont", "bgsound", "link", "meta", "noframes", "style"
]);
const IMPLIED_END_TAGS = new Set(["dd", "dt", "li", "optgroup", "option", "p", "rb", "rp", "rt", "rtc"]);
const BODY_END_ALLOWED_OPEN_ELEMENTS = new Set([
  "dd", "dt", "li", "optgroup", "option", "p", "rb", "rp", "rt", "rtc", "tbody", "td",
  "tfoot", "th", "thead", "tr", "body", "html"
]);

const DEFAULT_SCOPE_BOUNDARIES = new Set([
  "applet", "caption", "html", "table", "td", "th", "marquee", "object", "template"
]);
const LIST_ITEM_SCOPE_ADDITIONS = new Set(["ol", "ul"]);
const BUTTON_SCOPE_ADDITIONS = new Set(["button"]);
const BUTTON_SCOPE_BOUNDARIES = new Set([...DEFAULT_SCOPE_BOUNDARIES, ...BUTTON_SCOPE_ADDITIONS]);
const LIST_ITEM_SCOPE_BOUNDARIES = new Set([
  ...DEFAULT_SCOPE_BOUNDARIES,
  ...LIST_ITEM_SCOPE_ADDITIONS
]);

const SPECIAL_HTML_ELEMENTS = new Set([
  "address", "applet", "area", "article", "aside", "base", "basefont", "bgsound", "blockquote",
  "body", "br", "button", "caption", "center", "col", "colgroup", "dd", "details", "dir",
  "div", "dl", "dt", "embed", "fieldset", "figcaption", "figure", "footer", "form", "frame",
  "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr",
  "html", "iframe", "img", "input", "keygen", "li", "link", "listing", "main", "marquee",
  "menu", "meta", "nav", "noembed", "noframes", "noscript", "object", "ol", "p", "param",
  "plaintext", "pre", "script", "search", "section", "select", "source", "style", "summary",
  "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "title", "tr",
  "track", "ul", "wbr", "xmp"
]);

function tokenTagName(token: HtmlToken): string | null {
  return token.kind === "start-tag" || token.kind === "end-tag" ? token.name : null;
}

function isWhitespaceToken(token: HtmlToken): token is HtmlCharacterToken {
  return token.kind === "character" && ASCII_WHITESPACE.test(token.data);
}

function attributesFromToken(attributes: readonly HtmlTokenAttribute[]): readonly HtmlTreeAttributeInput[] {
  return attributes.map((attribute) => Object.freeze({
    namespaceUri: null,
    prefix: null,
    localName: attribute.name,
    qualifiedName: attribute.name,
    value: attribute.value,
    sourceSpan: attribute.span
  }));
}

function syntheticStartTag(name: string, token: HtmlToken): HtmlStartTagToken {
  return Object.freeze({
    kind: "start-tag",
    name,
    attributes: Object.freeze([]),
    selfClosing: false,
    span: token.span
  });
}

function doctypeExternalId(token: Extract<HtmlToken, { readonly kind: "doctype" }>) {
  if (token.publicIdentifier !== null) {
    return Object.freeze({
      kind: "public" as const,
      publicIdentifier: token.publicIdentifier,
      systemIdentifier: token.systemIdentifier
    });
  }
  if (token.systemIdentifier !== null) {
    return Object.freeze({ kind: "system" as const, systemIdentifier: token.systemIdentifier });
  }
  return Object.freeze({ kind: "none" as const });
}

/** Incremental HTML tree constructor. Every accepted token is fully handled before return. */
export class HtmlTreeBuilder implements TokenSink {
  readonly #model: HtmlTreeModel;
  readonly #resources: EngineResourceGuard;
  readonly #scriptingMode: NonExecutingScriptingMode;
  readonly #observer: EngineObserver | undefined;
  readonly #onParseError: (error: EngineParseError) => void;
  readonly #openElements = new OpenElementStack();
  readonly #activeFormatting: ActiveFormattingEntry[] = [];
  readonly #templateInsertionModes: InsertionMode[] = [];
  #tokenizer: TokenizerControl | null = null;
  #insertionMode: InsertionMode = "initial";
  #originalInsertionMode: InsertionMode | null = null;
  #documentMode: HtmlDocumentMode = "no-quirks";
  #headElement: HtmlTreeElement | null = null;
  #formElement: HtmlTreeElement | null = null;
  #framesetOk = true;
  #fosterParenting = false;
  #ignoreNextLineFeed = false;
  #finished = false;

  constructor(options: HtmlTreeBuilderOptions) {
    this.#model = options.model;
    this.#resources = options.resources;
    this.#scriptingMode = options.scriptingMode;
    this.#observer = options.observer;
    this.#onParseError = options.onParseError;
  }

  connectTokenizer(tokenizer: TokenizerControl): void {
    if (this.#tokenizer !== null) {
      failInternalState("TREE_BUILDER_TOKENIZER_ALREADY_CONNECTED");
    }
    this.#resources.ensureActive();
    this.#tokenizer = tokenizer;
  }

  accept(token: HtmlToken): TokenAcceptance {
    if (this.#tokenizer === null) failInternalState("TREE_BUILDER_TOKENIZER_NOT_CONNECTED");
    if (this.#finished) failInternalState("TREE_BUILDER_TOKEN_AFTER_EOF");
    this.#resources.checkpoint();
    let mode: InsertionMode = this.#insertionMode;
    let acknowledged = false;
    for (;;) {
      this.#resources.checkpoint();
      const nextMode = this.#process(mode, token, () => { acknowledged = true; });
      if (nextMode === null) break;
      mode = nextMode;
    }
    return Object.freeze({ selfClosingAcknowledged: acknowledged });
  }

  state(): HtmlTreeBuilderState {
    return Object.freeze({
      insertionMode: this.#insertionMode,
      originalInsertionMode: this.#originalInsertionMode,
      documentMode: this.#documentMode,
      openElementCount: this.#openElements.length,
      activeFormattingEntryCount: this.#activeFormatting.length,
      templateInsertionModes: Object.freeze([...this.#templateInsertionModes]),
      headElement: this.#headElement,
      formElement: this.#formElement,
      framesetOk: this.#framesetOk,
      fosterParenting: this.#fosterParenting,
      finished: this.#finished
    });
  }

  #process(
    mode: InsertionMode,
    token: HtmlToken,
    acknowledge: () => void
  ): InsertionMode | null {
    switch (mode) {
      case "initial": return this.#inInitial(token);
      case "before-html": return this.#inBeforeHtml(token);
      case "before-head": return this.#inBeforeHead(token);
      case "in-head": return this.#inHead(token, acknowledge);
      case "in-head-noscript": return this.#inHeadNoscript(token, acknowledge);
      case "after-head": return this.#inAfterHead(token, acknowledge);
      case "in-body": return this.#inBody(token, acknowledge);
      case "text": return this.#inText(token);
      case "after-body": return this.#inAfterBody(token, acknowledge);
      case "after-after-body": return this.#inAfterAfterBody(token, acknowledge);
      case "in-table":
      case "in-table-text":
      case "in-caption":
      case "in-column-group":
      case "in-table-body":
      case "in-row":
      case "in-cell":
        throw new HtmlTreeBuilderPendingFeatureError("table", mode);
      case "in-template": throw new HtmlTreeBuilderPendingFeatureError("template", mode);
      case "in-frameset":
      case "after-frameset":
      case "after-after-frameset":
        throw new HtmlTreeBuilderPendingFeatureError("frameset", mode);
    }
  }

  #inInitial(token: HtmlToken): InsertionMode | null {
    if (isWhitespaceToken(token)) return null;
    if (token.kind === "comment") {
      this.#insertComment(token, this.#model.root);
      return null;
    }
    if (token.kind === "processing-instruction") {
      this.#insertProcessingInstruction(token, this.#model.root);
      return null;
    }
    if (token.kind === "doctype") {
      if (
        token.name !== "html" ||
        token.publicIdentifier !== null ||
        (token.systemIdentifier !== null && token.systemIdentifier !== "about:legacy-compat")
      ) {
        this.#parseError(token, "initial");
      }
      const doctype = this.#model.createDoctype({
        name: token.name ?? "",
        externalId: doctypeExternalId(token),
        sourceSpan: token.span
      });
      this.#model.append(this.#model.root, doctype);
      this.#documentMode = documentModeForDoctype(token);
      this.#setInsertionMode("before-html", token);
      return null;
    }
    this.#parseError(token, "initial");
    this.#documentMode = "quirks";
    this.#setInsertionMode("before-html", token);
    return "before-html";
  }

  #inBeforeHtml(token: HtmlToken): InsertionMode | null {
    if (token.kind === "doctype") {
      this.#parseError(token, "before-html");
      return null;
    }
    if (token.kind === "comment") {
      this.#insertComment(token, this.#model.root);
      return null;
    }
    if (token.kind === "processing-instruction") {
      this.#insertProcessingInstruction(token, this.#model.root);
      return null;
    }
    if (isWhitespaceToken(token)) return null;
    if (token.kind === "start-tag" && token.name === "html") {
      const html = this.#createElement(token);
      this.#model.append(this.#model.root, html);
      this.#openElements.push(html);
      this.#setInsertionMode("before-head", token);
      return null;
    }
    if (token.kind === "end-tag" && !ROOT_IMPLYING_END_TAGS.has(token.name)) {
      this.#parseError(token, "before-html");
      return null;
    }
    const html = this.#createElementNamed("html");
    this.#model.append(this.#model.root, html);
    this.#openElements.push(html);
    this.#setInsertionMode("before-head", token);
    return "before-head";
  }

  #inBeforeHead(token: HtmlToken): InsertionMode | null {
    if (isWhitespaceToken(token)) return null;
    if (token.kind === "comment") {
      this.#insertComment(token);
      return null;
    }
    if (token.kind === "processing-instruction") {
      this.#insertProcessingInstruction(token);
      return null;
    }
    if (token.kind === "doctype") {
      this.#parseError(token, "before-head");
      return null;
    }
    if (token.kind === "start-tag" && token.name === "html") return "in-body";
    if (token.kind === "start-tag" && token.name === "head") {
      const head = this.#insertElement(token);
      this.#headElement = head;
      this.#setInsertionMode("in-head", token);
      return null;
    }
    if (token.kind === "end-tag" && !ROOT_IMPLYING_END_TAGS.has(token.name)) {
      this.#parseError(token, "before-head");
      return null;
    }
    const head = this.#insertElement(syntheticStartTag("head", token), false);
    this.#headElement = head;
    this.#setInsertionMode("in-head", token);
    return "in-head";
  }

  #inHead(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (isWhitespaceToken(token)) {
      this.#insertCharacter(token);
      return null;
    }
    if (token.kind === "comment") {
      this.#insertComment(token);
      return null;
    }
    if (token.kind === "processing-instruction") {
      this.#insertProcessingInstruction(token);
      return null;
    }
    if (token.kind === "doctype") {
      this.#parseError(token, "in-head");
      return null;
    }
    if (token.kind === "start-tag") {
      if (token.name === "html") return "in-body";
      if (VOID_HEAD_TAGS.has(token.name)) {
        this.#insertElement(token);
        this.#popCurrent();
        if (token.selfClosing) acknowledge();
        return null;
      }
      if (token.name === "title") {
        this.#insertTextElement(token, "rcdata");
        return null;
      }
      if (token.name === "noscript") {
        if (this.#scriptingMode !== "disabled") {
          this.#insertTextElement(token, "rawtext");
        } else {
          this.#insertElement(token);
          this.#setInsertionMode("in-head-noscript", token);
        }
        return null;
      }
      if (token.name === "noframes" || token.name === "style") {
        this.#insertTextElement(token, "rawtext");
        return null;
      }
      if (token.name === "script") {
        this.#insertTextElement(token, "script-data");
        return null;
      }
      if (token.name === "template") throw new HtmlTreeBuilderPendingFeatureError("template", "in-head");
      if (token.name === "head") {
        this.#parseError(token, "in-head");
        return null;
      }
    }
    if (token.kind === "end-tag") {
      if (token.name === "head") {
        this.#popCurrent();
        this.#setInsertionMode("after-head", token);
        return null;
      }
      if (token.name === "template") throw new HtmlTreeBuilderPendingFeatureError("template", "in-head");
      if (!AFTER_HEAD_IMPLYING_END_TAGS.has(token.name)) {
        this.#parseError(token, "in-head");
        return null;
      }
    }
    this.#popCurrent();
    this.#setInsertionMode("after-head", token);
    return "after-head";
  }

  #inHeadNoscript(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "doctype") {
      this.#parseError(token, "in-head-noscript");
      return null;
    }
    if (token.kind === "start-tag" && token.name === "html") return "in-body";
    if (token.kind === "end-tag" && token.name === "noscript") {
      this.#popCurrent();
      this.#setInsertionMode("in-head", token);
      return null;
    }
    if (
      isWhitespaceToken(token) ||
      token.kind === "comment" ||
      token.kind === "processing-instruction" ||
      (token.kind === "start-tag" && HEAD_NOSCRIPT_DELEGATE_TAGS.has(token.name))
    ) {
      return this.#inHead(token, acknowledge);
    }
    if (
      (token.kind === "start-tag" && (token.name === "head" || token.name === "noscript")) ||
      (token.kind === "end-tag" && token.name !== "br")
    ) {
      this.#parseError(token, "in-head-noscript");
      return null;
    }
    this.#parseError(token, "in-head-noscript");
    this.#popCurrent();
    this.#setInsertionMode("in-head", token);
    return "in-head";
  }

  #inAfterHead(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (isWhitespaceToken(token)) {
      this.#insertCharacter(token);
      return null;
    }
    if (token.kind === "comment") {
      this.#insertComment(token);
      return null;
    }
    if (token.kind === "processing-instruction") {
      this.#insertProcessingInstruction(token);
      return null;
    }
    if (token.kind === "doctype") {
      this.#parseError(token, "after-head");
      return null;
    }
    if (token.kind === "start-tag") {
      if (token.name === "html") return "in-body";
      if (token.name === "body") {
        this.#insertElement(token);
        this.#framesetOk = false;
        this.#setInsertionMode("in-body", token);
        return null;
      }
      if (token.name === "frameset") throw new HtmlTreeBuilderPendingFeatureError("frameset", "after-head");
      if (HEAD_BODY_DELEGATE_TAGS.has(token.name)) {
        if (token.name === "template") throw new HtmlTreeBuilderPendingFeatureError("template", "after-head");
        this.#parseError(token, "after-head");
        const head = requireInternalValue(this.#headElement, "TREE_BUILDER_HEAD_POINTER_MISSING");
        this.#openElements.push(head);
        this.#inHead(token, acknowledge);
        this.#removeOpenElement(head);
        return null;
      }
      if (token.name === "head") {
        this.#parseError(token, "after-head");
        return null;
      }
    }
    if (token.kind === "end-tag") {
      if (token.name === "template") throw new HtmlTreeBuilderPendingFeatureError("template", "after-head");
      if (!AFTER_HEAD_IMPLYING_END_TAGS.has(token.name)) {
        this.#parseError(token, "after-head");
        return null;
      }
    }
    this.#insertElement(syntheticStartTag("body", token), false);
    this.#setInsertionMode("in-body", token);
    return "in-body";
  }

  #inBody(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "character") {
      if (this.#ignoreNextLineFeed) {
        this.#ignoreNextLineFeed = false;
        if (token.data === "\n") return null;
      }
      this.#insertCharacter(token);
      if (!isWhitespaceToken(token)) this.#framesetOk = false;
      return null;
    }
    this.#ignoreNextLineFeed = false;
    if (token.kind === "comment") {
      this.#insertComment(token);
      return null;
    }
    if (token.kind === "processing-instruction") {
      this.#insertProcessingInstruction(token);
      return null;
    }
    if (token.kind === "doctype") {
      this.#parseError(token, "in-body");
      return null;
    }
    if (token.kind === "eof") {
      if (this.#templateInsertionModes.length > 0) {
        throw new HtmlTreeBuilderPendingFeatureError("template", "in-body");
      }
      if (this.#hasUnexpectedOpenElementAtBodyEnd()) this.#parseError(token, "in-body");
      this.#finished = true;
      return null;
    }
    if (token.kind === "start-tag") return this.#startTagInBody(token, acknowledge);
    return this.#endTagInBody(token, acknowledge);
  }

  #startTagInBody(token: HtmlStartTagToken, acknowledge: () => void): InsertionMode | null {
    const name = token.name;
    if (name === "html") {
      this.#parseError(token, "in-body");
      const html = this.#openElements.at(0);
      if (html !== null) this.#model.adoptAttributes(html, attributesFromToken(token.attributes));
      return null;
    }
    if (HEAD_BODY_DELEGATE_TAGS.has(name)) {
      if (name === "template") throw new HtmlTreeBuilderPendingFeatureError("template", "in-body");
      return this.#inHead(token, acknowledge);
    }
    if (name === "body") {
      this.#parseError(token, "in-body");
      const body = this.#openElements.at(1);
      if (body?.localName === "body") {
        this.#framesetOk = false;
        this.#model.adoptAttributes(body, attributesFromToken(token.attributes));
      }
      return null;
    }
    if (name === "frameset") throw new HtmlTreeBuilderPendingFeatureError("frameset", "in-body");
    if (BLOCK_START_TAGS.has(name)) {
      this.#closeParagraphIfInButtonScope();
      this.#insertElement(token);
      return null;
    }
    if (HEADING_TAGS.has(name)) {
      this.#closeParagraphIfInButtonScope();
      const current = this.#currentNode();
      if (HEADING_TAGS.has(current.localName)) {
        this.#parseError(token, "in-body");
        this.#popCurrent();
      }
      this.#insertElement(token);
      return null;
    }
    if (name === "pre" || name === "listing") {
      this.#closeParagraphIfInButtonScope();
      this.#insertElement(token);
      this.#ignoreNextLineFeed = true;
      this.#framesetOk = false;
      return null;
    }
    if (name === "form") {
      if (this.#formElement !== null) {
        this.#parseError(token, "in-body");
        return null;
      }
      this.#closeParagraphIfInButtonScope();
      this.#formElement = this.#insertElement(token);
      return null;
    }
    if (name === "li") {
      this.#framesetOk = false;
      this.#closeListItemIfOpen("li", token);
      this.#closeParagraphIfInButtonScope();
      this.#insertElement(token);
      return null;
    }
    if (name === "dd" || name === "dt") {
      this.#framesetOk = false;
      this.#closeListItemIfOpen(name, token);
      this.#closeParagraphIfInButtonScope();
      this.#insertElement(token);
      return null;
    }
    if (name === "plaintext") {
      this.#closeParagraphIfInButtonScope();
      this.#insertElement(token);
      this.#tokenizerControl().setMode("plaintext");
      return null;
    }
    if (name === "button") {
      if (this.#hasInScope("button", "default")) {
        this.#parseError(token, "in-body");
        this.#generateImpliedEndTags();
        this.#popThrough("button");
      }
      this.#insertElement(token);
      this.#framesetOk = false;
      return null;
    }
    if (FORMATTING_TAGS.has(name)) {
      const element = this.#insertElement(token);
      this.#activeFormatting.push(Object.freeze({ kind: "element", element, token }));
      return null;
    }
    if (name === "applet" || name === "marquee" || name === "object") {
      this.#insertElement(token);
      this.#activeFormatting.push(Object.freeze({ kind: "marker" }));
      this.#framesetOk = false;
      return null;
    }
    if (name === "table") throw new HtmlTreeBuilderPendingFeatureError("table", "in-body");
    if (name === "select" || name === "optgroup" || name === "option") {
      throw new HtmlTreeBuilderPendingFeatureError("select", "in-body");
    }
    if (name === "math" || name === "svg") {
      throw new HtmlTreeBuilderPendingFeatureError("foreign-content", "in-body");
    }
    if (name === "area" || name === "br" || name === "embed" || name === "img" || name === "keygen" || name === "wbr") {
      this.#insertElement(token);
      this.#popCurrent();
      if (token.selfClosing) acknowledge();
      this.#framesetOk = false;
      return null;
    }
    if (name === "input") {
      this.#insertElement(token);
      this.#popCurrent();
      if (token.selfClosing) acknowledge();
      const type = token.attributes.find((attribute) => attribute.name === "type")?.value;
      if (type?.toLowerCase() !== "hidden") this.#framesetOk = false;
      return null;
    }
    if (name === "param" || name === "source" || name === "track") {
      this.#insertElement(token);
      this.#popCurrent();
      if (token.selfClosing) acknowledge();
      return null;
    }
    if (name === "hr") {
      this.#closeParagraphIfInButtonScope();
      this.#insertElement(token);
      this.#popCurrent();
      if (token.selfClosing) acknowledge();
      this.#framesetOk = false;
      return null;
    }
    if (name === "image") {
      this.#parseError(token, "in-body");
      const renamed: HtmlStartTagToken = Object.freeze({ ...token, name: "img" });
      return this.#startTagInBody(renamed, acknowledge);
    }
    if (name === "textarea") {
      this.#insertTextElement(token, "rcdata");
      this.#ignoreNextLineFeed = true;
      this.#framesetOk = false;
      return null;
    }
    if (name === "xmp") {
      this.#closeParagraphIfInButtonScope();
      this.#insertTextElement(token, "rawtext");
      this.#framesetOk = false;
      return null;
    }
    if (name === "iframe") {
      this.#framesetOk = false;
      this.#insertTextElement(token, "rawtext");
      return null;
    }
    if (name === "noembed" || (name === "noscript" && this.#scriptingMode !== "disabled")) {
      this.#insertTextElement(token, "rawtext");
      return null;
    }
    if (name === "rb" || name === "rtc" || name === "rp" || name === "rt") {
      this.#insertElement(token);
      return null;
    }
    this.#insertElement(token);
    return null;
  }

  #endTagInBody(token: HtmlEndTagToken, acknowledge: () => void): InsertionMode | null {
    const name = token.name;
    if (name === "template") throw new HtmlTreeBuilderPendingFeatureError("template", "in-body");
    if (name === "body") {
      if (!this.#hasInScope("body", "default")) {
        this.#parseError(token, "in-body");
        return null;
      }
      if (this.#hasUnexpectedOpenElementAtBodyEnd()) this.#parseError(token, "in-body");
      this.#setInsertionMode("after-body", token);
      return null;
    }
    if (name === "html") {
      if (!this.#hasInScope("body", "default")) {
        this.#parseError(token, "in-body");
        return null;
      }
      if (this.#hasUnexpectedOpenElementAtBodyEnd()) this.#parseError(token, "in-body");
      this.#setInsertionMode("after-body", token);
      return "after-body";
    }
    if (BLOCK_END_TAGS.has(name)) {
      if (!this.#hasInScope(name, "default")) {
        this.#parseError(token, "in-body");
        return null;
      }
      this.#generateImpliedEndTags();
      if (this.#currentNode().localName !== name) this.#parseError(token, "in-body");
      this.#popThrough(name);
      return null;
    }
    if (name === "form") {
      const form = this.#formElement;
      this.#formElement = null;
      if (form === null || !this.#openElements.includes(form)) {
        this.#parseError(token, "in-body");
        return null;
      }
      this.#removeOpenElement(form);
      return null;
    }
    if (name === "p") {
      if (!this.#hasInScope("p", "button")) {
        this.#parseError(token, "in-body");
        this.#insertElement(syntheticStartTag("p", token), false);
      }
      this.#closeParagraph();
      return null;
    }
    if (name === "li") {
      if (!this.#hasInScope("li", "list-item")) {
        this.#parseError(token, "in-body");
        return null;
      }
      this.#generateImpliedEndTags("li");
      if (this.#currentNode().localName !== "li") this.#parseError(token, "in-body");
      this.#popThrough("li");
      return null;
    }
    if (name === "dd" || name === "dt") {
      if (!this.#hasInScope(name, "default")) {
        this.#parseError(token, "in-body");
        return null;
      }
      this.#generateImpliedEndTags(name);
      if (this.#currentNode().localName !== name) this.#parseError(token, "in-body");
      this.#popThrough(name);
      return null;
    }
    if (HEADING_TAGS.has(name)) {
      const heading = this.#lastInScope(HEADING_TAGS);
      if (heading === null) {
        this.#parseError(token, "in-body");
        return null;
      }
      this.#generateImpliedEndTags();
      if (this.#currentNode() !== heading) this.#parseError(token, "in-body");
      this.#popThroughElement(heading);
      return null;
    }
    if (FORMATTING_TAGS.has(name)) {
      return this.#genericEndTag(token);
    }
    if (name === "applet" || name === "marquee" || name === "object") {
      if (!this.#hasInScope(name, "default")) {
        this.#parseError(token, "in-body");
        return null;
      }
      this.#generateImpliedEndTags();
      if (this.#currentNode().localName !== name) this.#parseError(token, "in-body");
      this.#popThrough(name);
      this.#clearFormattingToMarker();
      return null;
    }
    if (name === "br") {
      this.#parseError(token, "in-body");
      return this.#startTagInBody(syntheticStartTag("br", token), acknowledge);
    }
    return this.#genericEndTag(token);
  }

  #genericEndTag(token: HtmlEndTagToken): null {
    for (let index = this.#openElements.length - 1; index >= 0; index -= 1) {
      const node = this.#openElements.at(index);
      if (node === null) continue;
      if (node.localName === token.name) {
        this.#generateImpliedEndTags(token.name);
        if (this.#currentNode() !== node) this.#parseError(token, "in-body");
        this.#popThroughElement(node);
        return null;
      }
      if (this.#isSpecial(node)) {
        this.#parseError(token, "in-body");
        return null;
      }
    }
    return null;
  }

  #inText(token: HtmlToken): InsertionMode | null {
    if (token.kind === "character") {
      this.#insertCharacter(token);
      return null;
    }
    if (token.kind === "eof") {
      this.#parseError(token, "text");
      this.#popCurrent();
      const original = requireInternalValue(
        this.#originalInsertionMode,
        "TREE_BUILDER_ORIGINAL_MODE_MISSING"
      );
      this.#setInsertionMode(original, token);
      this.#originalInsertionMode = null;
      return original;
    }
    if (token.kind === "end-tag") {
      this.#popCurrent();
      const original = requireInternalValue(
        this.#originalInsertionMode,
        "TREE_BUILDER_ORIGINAL_MODE_MISSING"
      );
      this.#setInsertionMode(original, token);
      this.#originalInsertionMode = null;
      this.#tokenizerControl().setMode("data");
      return null;
    }
    failInternalState("TREE_BUILDER_STACK_ENTRY_MISSING");
  }

  #inAfterBody(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (isWhitespaceToken(token)) return this.#inBody(token, acknowledge);
    if (token.kind === "comment") {
      const html = requireInternalValue(this.#openElements.at(0), "TREE_BUILDER_STACK_ENTRY_MISSING");
      this.#insertComment(token, html);
      return null;
    }
    if (token.kind === "processing-instruction") {
      this.#insertProcessingInstruction(token);
      return null;
    }
    if (token.kind === "doctype") {
      this.#parseError(token, "after-body");
      return null;
    }
    if (token.kind === "start-tag" && token.name === "html") return this.#inBody(token, acknowledge);
    if (token.kind === "end-tag" && token.name === "html") {
      this.#setInsertionMode("after-after-body", token);
      return null;
    }
    if (token.kind === "eof") {
      this.#finished = true;
      return null;
    }
    this.#parseError(token, "after-body");
    this.#setInsertionMode("in-body", token);
    return "in-body";
  }

  #inAfterAfterBody(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "comment") {
      this.#insertComment(token, this.#model.root);
      return null;
    }
    if (token.kind === "processing-instruction") {
      this.#insertProcessingInstruction(token, this.#model.root);
      return null;
    }
    if (token.kind === "doctype" || isWhitespaceToken(token) ||
      (token.kind === "start-tag" && token.name === "html")) {
      return this.#inBody(token, acknowledge);
    }
    if (token.kind === "eof") {
      this.#finished = true;
      return null;
    }
    this.#parseError(token, "after-after-body");
    this.#setInsertionMode("in-body", token);
    return "in-body";
  }

  #createElement(token: HtmlStartTagToken): HtmlTreeElement {
    return this.#model.createElement({
      namespaceUri: HTML_NAMESPACE,
      prefix: null,
      localName: token.name,
      qualifiedName: token.name,
      attributes: attributesFromToken(token.attributes),
      sourceSpan: token.span
    });
  }

  #createElementNamed(name: string): HtmlTreeElement {
    return this.#model.createElement({
      namespaceUri: HTML_NAMESPACE,
      prefix: null,
      localName: name,
      qualifiedName: name
    });
  }

  #insertElement(token: HtmlStartTagToken, retainSpan = true): HtmlTreeElement {
    const element = retainSpan ? this.#createElement(token) : this.#createElementNamed(token.name);
    this.#insertAtAppropriateLocation(element);
    this.#openElements.push(element);
    return element;
  }

  #insertAtAppropriateLocation(node: HtmlTreeNode): void {
    const parent = this.#appropriateParent();
    this.#model.append(parent, node);
  }

  #appropriateParent(): HtmlTreeParent {
    if (this.#openElements.length === 0) return this.#model.root;
    return this.#currentNode();
  }

  #insertCharacter(token: Extract<HtmlToken, { readonly kind: "character" }>): void {
    const parent = this.#appropriateParent();
    this.#model.insertText(parent, token.data, token.span);
  }

  #insertComment(
    token: Extract<HtmlToken, { readonly kind: "comment" }>,
    parent: HtmlTreeParent = this.#appropriateParent()
  ): void {
    const comment = this.#model.createComment(token.data, token.span);
    this.#model.append(parent, comment);
  }

  #insertProcessingInstruction(
    token: Extract<HtmlToken, { readonly kind: "processing-instruction" }>,
    parent: HtmlTreeParent = this.#appropriateParent()
  ): void {
    const instruction = this.#model.createProcessingInstruction(token.target, token.data, token.span);
    this.#model.append(parent, instruction);
  }

  #insertTextElement(token: HtmlStartTagToken, tokenizerMode: TokenizerMode): void {
    this.#insertElement(token);
    this.#tokenizerControl().setMode(tokenizerMode);
    this.#originalInsertionMode = this.#insertionMode;
    this.#setInsertionMode("text", token);
  }

  #setInsertionMode(to: InsertionMode, token: HtmlToken): void {
    const from = this.#insertionMode;
    if (from === to) return;
    this.#insertionMode = to;
    this.#observer?.onInsertionModeTransition?.(Object.freeze({
      from,
      to,
      token: Object.freeze({ kind: token.kind, tagName: tokenTagName(token), span: token.span })
    }));
    this.#resources.ensureActive();
  }

  #parseError(token: HtmlToken, insertionMode: InsertionMode): void {
    this.#resources.reserveParseError();
    const error = createTreeBuilderParseError(insertionMode, token);
    this.#onParseError(error);
    this.#observer?.onParseError?.(error);
    this.#resources.ensureActive();
  }

  #tokenizerControl(): TokenizerControl {
    return requireInternalValue(this.#tokenizer, "TREE_BUILDER_TOKENIZER_NOT_CONNECTED");
  }

  #currentNode(): HtmlTreeElement {
    return this.#openElements.current();
  }

  #popCurrent(): HtmlTreeElement {
    return this.#openElements.pop();
  }

  #popThrough(name: string): void {
    for (;;) {
      if (this.#popCurrent().localName === name) return;
    }
  }

  #popThroughElement(element: HtmlTreeElement): void {
    for (;;) {
      if (this.#popCurrent() === element) return;
    }
  }

  #removeOpenElement(element: HtmlTreeElement): void {
    this.#openElements.remove(element);
  }

  #generateImpliedEndTags(except: string | null = null): void {
    while (IMPLIED_END_TAGS.has(this.#currentNode().localName) && this.#currentNode().localName !== except) {
      this.#popCurrent();
    }
  }

  #closeParagraphIfInButtonScope(): void {
    if (this.#hasInScope("p", "button")) this.#closeParagraph();
  }

  #closeParagraph(): void {
    this.#generateImpliedEndTags("p");
    this.#popThrough("p");
  }

  #closeListItemIfOpen(name: "li" | "dd" | "dt", token: HtmlToken): void {
    for (let index = this.#openElements.length - 1; index >= 0; index -= 1) {
      const node = this.#openElements.at(index);
      if (node === null) continue;
      const matches = name === "li" ? node.localName === "li" : node.localName === "dd" || node.localName === "dt";
      if (matches) {
        this.#generateImpliedEndTags(node.localName);
        if (this.#currentNode() !== node) this.#parseError(token, "in-body");
        this.#popThroughElement(node);
        return;
      }
      if (this.#isSpecial(node) && node.localName !== "address" && node.localName !== "div" && node.localName !== "p") return;
    }
  }

  #hasInScope(name: string, scope: "default" | "button" | "list-item"): boolean {
    const boundaries = scope === "button"
      ? BUTTON_SCOPE_BOUNDARIES
      : scope === "list-item" ? LIST_ITEM_SCOPE_BOUNDARIES : DEFAULT_SCOPE_BOUNDARIES;
    return this.#openElements.hasInScope(HTML_NAMESPACE, name, boundaries);
  }

  #lastInScope(names: ReadonlySet<string>): HtmlTreeElement | null {
    return this.#openElements.lastInScope(
      HTML_NAMESPACE,
      names,
      DEFAULT_SCOPE_BOUNDARIES
    );
  }

  #isSpecial(element: HtmlTreeElement): boolean {
    return element.namespaceUri === HTML_NAMESPACE && SPECIAL_HTML_ELEMENTS.has(element.localName);
  }

  #hasUnexpectedOpenElementAtBodyEnd(): boolean {
    return this.#openElements.some((element) =>
      element.namespaceUri !== HTML_NAMESPACE || !BODY_END_ALLOWED_OPEN_ELEMENTS.has(element.localName)
    );
  }

  #clearFormattingToMarker(): void {
    while (this.#activeFormatting.length > 0) {
      if (this.#activeFormatting.pop()?.kind === "marker") return;
    }
  }
}
