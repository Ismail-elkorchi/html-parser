import { failInternalState, requireInternalValue } from "../foundation/internal-state-error.js";

import { ActiveFormattingList } from "./active-formatting-list.js";
import { createTreeBuilderParseError } from "./diagnostics.js";
import { documentModeForDoctype, type HtmlDocumentMode } from "./doctype-mode.js";
import { HTML_NAMESPACE } from "./namespaces.js";
import { OpenElementStack } from "./open-element-stack.js";

import type {
  ActiveFormattingEntry
} from "./active-formatting-list.js";
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
const IN_BODY_IGNORED_START_TAGS = new Set([
  "caption", "col", "colgroup", "frame", "head", "tbody", "td", "tfoot", "th", "thead", "tr"
]);
const IMPLIED_END_TAGS = new Set(["dd", "dt", "li", "optgroup", "option", "p", "rb", "rp", "rt", "rtc"]);
const BODY_END_ALLOWED_OPEN_ELEMENTS = new Set([
  "dd", "dt", "li", "optgroup", "option", "p", "rb", "rp", "rt", "rtc", "tbody", "td",
  "tfoot", "th", "thead", "tr", "body", "html"
]);

const DEFAULT_SCOPE_BOUNDARIES = new Set([
  "applet", "caption", "html", "table", "td", "th", "marquee", "object", "select", "template"
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
  readonly #openElements: OpenElementStack;
  readonly #activeFormatting: ActiveFormattingList;
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
    this.#openElements = new OpenElementStack(options.resources);
    this.#activeFormatting = new ActiveFormattingList(options.resources);
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
      if (token.data === "\u0000") {
        this.#parseError(token, "in-body");
        return null;
      }
      this.#reconstructActiveFormatting();
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
    if (IN_BODY_IGNORED_START_TAGS.has(name)) {
      this.#parseError(token, "in-body");
      return null;
    }
    if (BLOCK_START_TAGS.has(name)) {
      this.#closeParagraphIfInButtonScope(token);
      this.#insertElement(token);
      return null;
    }
    if (HEADING_TAGS.has(name)) {
      this.#closeParagraphIfInButtonScope(token);
      const current = this.#currentNode();
      if (HEADING_TAGS.has(current.localName)) {
        this.#parseError(token, "in-body");
        this.#popCurrent();
      }
      this.#insertElement(token);
      return null;
    }
    if (name === "pre" || name === "listing") {
      this.#closeParagraphIfInButtonScope(token);
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
      this.#closeParagraphIfInButtonScope(token);
      this.#formElement = this.#insertElement(token);
      return null;
    }
    if (name === "li") {
      this.#framesetOk = false;
      this.#closePriorListItem("li", token);
      this.#closeParagraphIfInButtonScope(token);
      this.#insertElement(token);
      return null;
    }
    if (name === "dd" || name === "dt") {
      this.#framesetOk = false;
      this.#closePriorListItem(name, token);
      this.#closeParagraphIfInButtonScope(token);
      this.#insertElement(token);
      return null;
    }
    if (name === "plaintext") {
      this.#closeParagraphIfInButtonScope(token);
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
      this.#reconstructActiveFormatting();
      this.#insertElement(token);
      this.#framesetOk = false;
      return null;
    }
    if (name === "a") {
      const activeLink = this.#activeFormatting.lastElementWithTagName("a");
      if (activeLink !== null) {
        this.#parseError(token, "in-body");
        this.#runAdoptionAgency(token);
        this.#activeFormatting.removeElement(activeLink.element);
        if (this.#openElements.includes(activeLink.element)) {
          this.#removeOpenElement(activeLink.element);
        }
      }
      this.#reconstructActiveFormatting();
      const element = this.#insertElement(token);
      this.#activeFormatting.pushElement(element, token);
      return null;
    }
    if (name === "nobr") {
      this.#reconstructActiveFormatting();
      if (this.#hasInScope("nobr", "default")) {
        this.#parseError(token, "in-body");
        this.#runAdoptionAgency(token);
        this.#reconstructActiveFormatting();
      }
      const element = this.#insertElement(token);
      this.#activeFormatting.pushElement(element, token);
      return null;
    }
    if (FORMATTING_TAGS.has(name)) {
      this.#reconstructActiveFormatting();
      const element = this.#insertElement(token);
      this.#activeFormatting.pushElement(element, token);
      return null;
    }
    if (name === "applet" || name === "marquee" || name === "object") {
      this.#reconstructActiveFormatting();
      this.#insertElement(token);
      this.#activeFormatting.pushMarker();
      this.#framesetOk = false;
      return null;
    }
    if (name === "table") throw new HtmlTreeBuilderPendingFeatureError("table", "in-body");
    if (name === "select") {
      throw new HtmlTreeBuilderPendingFeatureError("select", "in-body");
    }
    if (name === "optgroup") {
      if (this.#hasInScope("select", "default")) {
        this.#generateImpliedEndTags();
        if (this.#hasInScope("option", "default") || this.#hasInScope("optgroup", "default")) {
          this.#parseError(token, "in-body");
        }
      } else if (this.#currentNode().localName === "option") {
        this.#popCurrent();
      }
      this.#reconstructActiveFormatting();
      this.#insertElement(token);
      return null;
    }
    if (name === "option") {
      if (this.#currentNode().localName === "option") this.#popCurrent();
      this.#reconstructActiveFormatting();
      this.#insertElement(token);
      return null;
    }
    if (name === "math" || name === "svg") {
      throw new HtmlTreeBuilderPendingFeatureError("foreign-content", "in-body");
    }
    if (name === "area" || name === "br" || name === "embed" || name === "img" || name === "keygen" || name === "wbr") {
      this.#reconstructActiveFormatting();
      this.#insertElement(token);
      this.#popCurrent();
      if (token.selfClosing) acknowledge();
      this.#framesetOk = false;
      return null;
    }
    if (name === "input") {
      this.#reconstructActiveFormatting();
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
      this.#closeParagraphIfInButtonScope(token);
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
      this.#closeParagraphIfInButtonScope(token);
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
      if (this.#hasInScope("ruby", "default")) {
        this.#generateImpliedEndTags(name === "rp" || name === "rt" ? "rtc" : null);
        const currentName = this.#currentNode().localName;
        const expected = name === "rp" || name === "rt"
          ? currentName === "rtc" || currentName === "ruby"
          : currentName === "ruby";
        if (!expected) this.#parseError(token, "in-body");
      }
      this.#insertElement(token);
      return null;
    }
    this.#reconstructActiveFormatting();
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
      if (
        form === null ||
        !this.#openElements.hasElementInScope(form, DEFAULT_SCOPE_BOUNDARIES)
      ) {
        this.#parseError(token, "in-body");
        return null;
      }
      this.#generateImpliedEndTags();
      if (this.#currentNode() !== form) this.#parseError(token, "in-body");
      this.#removeOpenElement(form);
      return null;
    }
    if (name === "p") {
      if (!this.#hasInScope("p", "button")) {
        this.#parseError(token, "in-body");
        this.#insertElement(syntheticStartTag("p", token), false);
      }
      this.#closeParagraph(token);
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
      if (this.#currentNode().localName !== name) this.#parseError(token, "in-body");
      this.#popThroughElement(heading);
      return null;
    }
    if (FORMATTING_TAGS.has(name)) {
      this.#runAdoptionAgency(token);
      return null;
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

  #genericEndTag(token: HtmlStartTagToken | HtmlEndTagToken): null {
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
    if (this.#ignoreNextLineFeed) {
      this.#ignoreNextLineFeed = false;
      if (token.kind === "character" && token.data === "\n") return null;
    }
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

  #insertAtAppropriateLocation(node: HtmlTreeNode, overrideTarget?: HtmlTreeElement): void {
    const parent = overrideTarget ?? this.#appropriateParent();
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

  #closeParagraphIfInButtonScope(token: HtmlToken): void {
    if (this.#hasInScope("p", "button")) this.#closeParagraph(token);
  }

  #closeParagraph(token: HtmlToken): void {
    this.#generateImpliedEndTags("p");
    if (this.#currentNode().localName !== "p") this.#parseError(token, "in-body");
    this.#popThrough("p");
  }

  #closePriorListItem(name: "li" | "dd" | "dt", token: HtmlToken): void {
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

  #reconstructActiveFormatting(): void {
    let entry = this.#activeFormatting.last();
    if (
      entry === null ||
      entry.kind === "marker" ||
      this.#openElements.includes(entry.element)
    ) {
      return;
    }

    for (;;) {
      this.#resources.checkpoint();
      const previous = this.#activeFormatting.previous(entry);
      if (
        previous === null ||
        previous.kind === "marker" ||
        this.#openElements.includes(previous.element)
      ) {
        break;
      }
      entry = previous;
    }

    while (entry !== null) {
      this.#resources.checkpoint();
      if (entry.kind !== "element") {
        failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
      }
      const element = this.#insertElement(entry.token);
      const replacement = this.#activeFormatting.replace(entry, element);
      entry = this.#activeFormatting.next(replacement);
    }
  }

  #runAdoptionAgency(token: HtmlStartTagToken | HtmlEndTagToken): void {
    const subject = token.name;
    const current = this.#currentNode();
    if (
      current.namespaceUri === HTML_NAMESPACE &&
      current.localName === subject &&
      !this.#activeFormatting.includesElement(current)
    ) {
      this.#popCurrent();
      return;
    }

    for (let outer = 0; outer < 8; outer += 1) {
      this.#resources.checkpoint();
      const formattingEntry = this.#activeFormatting.lastElementWithTagName(subject);
      if (formattingEntry === null) {
        this.#genericEndTag(token);
        return;
      }
      const formattingElement = formattingEntry.element;
      if (!this.#openElements.includes(formattingElement)) {
        this.#parseError(token, "in-body");
        this.#activeFormatting.removeElement(formattingElement);
        return;
      }
      if (!this.#openElements.hasElementInScope(formattingElement, DEFAULT_SCOPE_BOUNDARIES)) {
        this.#parseError(token, "in-body");
        return;
      }
      if (formattingElement !== this.#currentNode()) this.#parseError(token, "in-body");

      const formattingStackIndex = this.#openElements.indexOf(formattingElement);
      let furthestBlock: HtmlTreeElement | null = null;
      for (let index = formattingStackIndex + 1; index < this.#openElements.length; index += 1) {
        this.#resources.checkpoint();
        const candidate = this.#openElements.at(index);
        if (candidate !== null && this.#isSpecial(candidate)) {
          furthestBlock = candidate;
          break;
        }
      }
      if (furthestBlock === null) {
        this.#popThroughElement(formattingElement);
        this.#activeFormatting.removeElement(formattingElement);
        return;
      }

      const commonAncestor = requireInternalValue(
        this.#openElements.at(formattingStackIndex - 1),
        "TREE_BUILDER_STACK_ENTRY_MISSING"
      );
      let bookmark: ActiveFormattingEntry | null = formattingEntry;
      let lastNode = furthestBlock;
      let nodeIndex = this.#openElements.indexOf(furthestBlock);

      for (let inner = 1; ; inner += 1) {
        this.#resources.checkpoint();
        nodeIndex -= 1;
        const node = requireInternalValue(
          this.#openElements.at(nodeIndex),
          "TREE_BUILDER_STACK_ENTRY_MISSING"
        );
        if (node === formattingElement) break;

        let activeEntry = this.#activeFormatting.entryForElement(node);
        if (inner > 3 && activeEntry !== null) {
          if (bookmark === activeEntry) bookmark = this.#activeFormatting.next(activeEntry);
          this.#activeFormatting.remove(activeEntry);
          activeEntry = null;
        }
        if (activeEntry === null) {
          this.#openElements.remove(node);
          continue;
        }

        const replacement = this.#createElement(activeEntry.token);
        const replacementEntry = this.#activeFormatting.replace(activeEntry, replacement);
        this.#openElements.replace(node, replacement);
        if (lastNode === furthestBlock) {
          bookmark = this.#activeFormatting.next(replacementEntry);
        }
        this.#model.append(replacement, lastNode);
        lastNode = replacement;
      }

      this.#insertAtAppropriateLocation(lastNode, commonAncestor);
      const replacementFormatting = this.#createElement(formattingEntry.token);
      this.#model.moveChildren(furthestBlock, replacementFormatting);
      this.#model.append(furthestBlock, replacementFormatting);

      if (bookmark === formattingEntry) bookmark = this.#activeFormatting.next(formattingEntry);
      this.#activeFormatting.remove(formattingEntry);
      this.#activeFormatting.insertElementBefore(
        bookmark,
        replacementFormatting,
        formattingEntry.token
      );
      this.#openElements.remove(formattingElement);
      this.#openElements.insertAfter(furthestBlock, replacementFormatting);
    }
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
    this.#activeFormatting.clearToMarker();
  }
}
