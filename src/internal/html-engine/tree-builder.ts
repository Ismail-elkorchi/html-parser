import { failInternalState, requireInternalValue } from "../foundation/internal-state-error.ts";

import { ActiveFormattingList } from "./active-formatting-list.ts";
import { createTreeBuilderParseError } from "./diagnostics.ts";
import { documentModeForDoctype, type HtmlDocumentMode } from "./doctype-mode.ts";
import {
  adjustedForeignAttributes,
  adjustedForeignTagName,
  hasForeignBreakoutFontAttribute,
  isForeignBreakoutStartTag,
  isHtmlIntegrationPoint,
  isMathMLTextIntegrationPoint
} from "./foreign-content.ts";
import { fragmentContextAttributes } from "./fragment-context.ts";
import { HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE } from "./namespaces.ts";
import { OpenElementStack } from "./open-element-stack.ts";
import { sourceSpan } from "./positions.ts";
import { HtmlSelectElementState } from "./select-element-state.ts";

import type {
  ActiveFormattingEntry
} from "./active-formatting-list.ts";
import type { EngineParseError } from "./diagnostics.ts";
import type { HtmlFragmentContext } from "./fragment-context.ts";
import type {
  EngineObserver,
  TokenAcceptance,
  TokenizerControl,
  TokenSink
} from "./observer.ts";
import type { OpenElementName } from "./open-element-stack.ts";
import type { InsertionMode, NonExecutingScriptingMode, TokenizerMode } from "./parser-state.ts";
import type { EngineResourceGuard } from "./resource-guard.ts";
import type {
  HtmlEndTagToken,
  HtmlCharacterToken,
  HtmlStartTagToken,
  HtmlToken,
  HtmlTokenAttribute
} from "./tokens.ts";
import type {
  HtmlTreeAttributeInput,
  HtmlTreeElement,
  HtmlTreeModel,
  HtmlTreeNode,
  HtmlTreeParent
} from "./tree-model.ts";

interface HtmlTreeBuilderCommonOptions {
  readonly model: HtmlTreeModel;
  readonly resources: EngineResourceGuard;
  readonly scriptingMode: NonExecutingScriptingMode;
  readonly retainNodeSpans?: boolean;
  readonly observer?: EngineObserver;
  readonly onParseError: (error: EngineParseError) => void;
}

type HtmlTreeBuilderOptions = HtmlTreeBuilderCommonOptions & (
  | {
      readonly fragmentContext?: undefined;
      readonly fragmentDocumentMode?: never;
      readonly hasFormInContextChain?: never;
    }
  | {
      readonly fragmentContext: HtmlFragmentContext;
      readonly fragmentDocumentMode: HtmlDocumentMode;
      readonly hasFormInContextChain: boolean;
    }
);

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

interface InsertionLocation {
  readonly parent: HtmlTreeParent;
  readonly before: HtmlTreeNode | null;
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
const THOROUGH_IMPLIED_END_TAGS = new Set([
  ...IMPLIED_END_TAGS,
  "caption", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr"
]);
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
const TABLE_SCOPE_BOUNDARIES = new Set(["html", "table", "template"]);
const TABLE_BODY_TAGS = new Set(["tbody", "tfoot", "thead"]);
const TABLE_CELL_TAGS = new Set(["td", "th"]);
const TABLE_CHARACTER_CURRENT_TAGS = new Set(["table", "tbody", "template", "tfoot", "thead", "tr"]);
const TABLE_IGNORED_END_TAGS = new Set([
  "body", "caption", "col", "colgroup", "html", "tbody", "td", "tfoot", "th", "thead", "tr"
]);
const CAPTION_BREAKOUT_START_TAGS = new Set([
  "caption", "col", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr"
]);
const CAPTION_IGNORED_END_TAGS = new Set([
  "body", "col", "colgroup", "html", "tbody", "td", "tfoot", "th", "thead", "tr"
]);
const TABLE_BODY_BREAKOUT_START_TAGS = new Set(["caption", "col", "colgroup", "tbody", "tfoot", "thead"]);
const TABLE_BODY_IGNORED_END_TAGS = new Set(["body", "caption", "col", "colgroup", "html", "td", "th", "tr"]);
const ROW_BREAKOUT_START_TAGS = new Set(["caption", "col", "colgroup", "tbody", "tfoot", "thead", "tr"]);
const ROW_IGNORED_END_TAGS = new Set(["body", "caption", "col", "colgroup", "html", "td", "th"]);
const CELL_BREAKOUT_START_TAGS = new Set(["caption", "col", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr"]);
const CELL_BREAKOUT_END_TAGS = new Set(["table", "tbody", "tfoot", "thead", "tr"]);
const CELL_IGNORED_END_TAGS = new Set(["body", "caption", "col", "colgroup", "html"]);
const TEMPLATE_HEAD_START_TAGS = new Set([
  "base", "basefont", "bgsound", "link", "meta", "noframes", "script", "style", "template", "title"
]);
const TEMPLATE_TABLE_START_TAGS = new Set(["caption", "colgroup", "tbody", "tfoot", "thead"]);
const FOSTER_PARENTING_TARGET_TAGS = new Set(["table", "tbody", "tfoot", "thead", "tr"]);
const TABLE_CONTEXT_CLEAR_TAGS = new Set(["html", "table", "template"]);
const TABLE_BODY_CONTEXT_CLEAR_TAGS = new Set(["html", "tbody", "template", "tfoot", "thead"]);
const TABLE_ROW_CONTEXT_CLEAR_TAGS = new Set(["html", "template", "tr"]);

const FOREIGN_SCOPE_BOUNDARIES: readonly OpenElementName[] = Object.freeze([
  ...["mi", "mo", "mn", "ms", "mtext", "annotation-xml"].map((localName) =>
    Object.freeze({ namespaceUri: MATHML_NAMESPACE, localName })
  ),
  ...["foreignObject", "desc", "title"].map((localName) =>
    Object.freeze({ namespaceUri: SVG_NAMESPACE, localName })
  )
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
const SPECIAL_MATHML_ELEMENTS = new Set(["mi", "mo", "mn", "ms", "mtext", "annotation-xml"]);
const SPECIAL_SVG_ELEMENTS = new Set(["foreignObject", "desc", "title"]);

function tokenTagName(token: HtmlToken): string | null {
  return token.kind === "start-tag" || token.kind === "end-tag" ? token.name : null;
}

function isWhitespaceToken(token: HtmlToken): boolean {
  return token.kind === "character" && ASCII_WHITESPACE.test(token.data);
}

function attributesFromToken(
  attributes: readonly HtmlTokenAttribute[],
  retainSpans: boolean
): readonly HtmlTreeAttributeInput[] {
  return attributes.map((attribute) => Object.freeze({
    namespaceUri: null,
    prefix: null,
    localName: attribute.name,
    qualifiedName: attribute.name,
    value: attribute.value,
    sourceSpan: retainSpans ? attribute.span : null
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
  readonly #retainNodeSpans: boolean;
  readonly #observer: EngineObserver | undefined;
  readonly #onParseError: (error: EngineParseError) => void;
  readonly #openElements: OpenElementStack;
  readonly #activeFormatting: ActiveFormattingList;
  readonly #selectElements: HtmlSelectElementState;
  readonly #fragmentContext: HtmlTreeElement | null;
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
  #pendingTableCharacters: HtmlCharacterToken[] = [];
  #finished = false;
  #activeToken: HtmlToken | null = null;

  constructor(options: HtmlTreeBuilderOptions) {
    this.#model = options.model;
    this.#resources = options.resources;
    this.#scriptingMode = options.scriptingMode;
    this.#retainNodeSpans = options.retainNodeSpans ?? true;
    this.#observer = options.observer;
    this.#onParseError = options.onParseError;
    this.#openElements = new OpenElementStack(options.resources);
    this.#activeFormatting = new ActiveFormattingList(options.resources);
    this.#selectElements = new HtmlSelectElementState(options.model, options.resources);
    if (options.fragmentContext === undefined) {
      if (options.model.root.kind !== "document") {
        failInternalState("TREE_BUILDER_FRAGMENT_CONTEXT_MISSING");
      }
      this.#fragmentContext = null;
    } else {
      if (options.model.root.kind !== "fragment") {
        failInternalState("TREE_BUILDER_FRAGMENT_CONTEXT_UNEXPECTED");
      }
      const root = this.#createElementNamed("html");
      this.#openElements.push(root);
      this.#fragmentContext = this.#model.createElement({
        namespaceUri: options.fragmentContext.namespaceUri,
        prefix: null,
        localName: options.fragmentContext.localName,
        qualifiedName: options.fragmentContext.localName,
        attributes: fragmentContextAttributes(options.fragmentContext)
      });
      this.#documentMode = options.fragmentDocumentMode;
      if (options.hasFormInContextChain) this.#formElement = this.#fragmentContext;
      if (
        this.#fragmentContext.namespaceUri === HTML_NAMESPACE &&
        this.#fragmentContext.localName === "template"
      ) {
        this.#templateInsertionModes.push("in-template");
      }
      this.#resetInsertionMode(null);
    }
  }

  connectTokenizer(tokenizer: TokenizerControl): void {
    if (this.#tokenizer !== null) {
      failInternalState("TREE_BUILDER_TOKENIZER_ALREADY_CONNECTED");
    }
    this.#resources.ensureActive();
    this.#tokenizer = tokenizer;
    this.#updateTokenizerForeignContext();
  }

  accept(token: HtmlToken): TokenAcceptance {
    if (this.#tokenizer === null) failInternalState("TREE_BUILDER_TOKENIZER_NOT_CONNECTED");
    if (this.#finished) failInternalState("TREE_BUILDER_TOKEN_AFTER_EOF");
    this.#resources.checkpoint();
    this.#activeToken = token;
    let acknowledged = false;
    try {
      let mode: InsertionMode = this.#insertionMode;
      let useForeignRules = !this.#shouldProcessInHtml(token);
      for (;;) {
        this.#resources.checkpoint();
        const nextMode = useForeignRules
          ? this.#inForeignContent(token, () => { acknowledged = true; })
          : this.#process(mode, token, () => { acknowledged = true; });
        useForeignRules = false;
        if (nextMode === null) break;
        mode = nextMode;
      }
      this.#updateTokenizerForeignContext();
      return acknowledged;
    } finally {
      this.#activeToken = null;
    }
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
      case "in-table": return this.#inTable(token, acknowledge);
      case "in-table-text": return this.#inTableText(token, acknowledge);
      case "in-caption": return this.#inCaption(token, acknowledge);
      case "in-column-group": return this.#inColumnGroup(token, acknowledge);
      case "in-table-body": return this.#inTableBody(token, acknowledge);
      case "in-row": return this.#inRow(token, acknowledge);
      case "in-cell": return this.#inCell(token, acknowledge);
      case "in-template": return this.#inTemplate(token, acknowledge);
      case "after-body": return this.#inAfterBody(token, acknowledge);
      case "in-frameset": return this.#inFrameset(token, acknowledge);
      case "after-frameset": return this.#inAfterFrameset(token, acknowledge);
      case "after-after-body": return this.#inAfterAfterBody(token, acknowledge);
      case "after-after-frameset": return this.#inAfterAfterFrameset(token, acknowledge);
    }
  }

  #shouldProcessInHtml(token: HtmlToken): boolean {
    if (this.#openElements.length === 0) return true;
    const adjusted = this.#adjustedCurrentNode();
    if (adjusted.namespaceUri === HTML_NAMESPACE) return true;
    if (
      isMathMLTextIntegrationPoint(adjusted) &&
      ((token.kind === "start-tag" && token.name !== "mglyph" && token.name !== "malignmark") ||
        token.kind === "character")
    ) {
      return true;
    }
    if (
      adjusted.namespaceUri === MATHML_NAMESPACE &&
      adjusted.localName === "annotation-xml" &&
      token.kind === "start-tag" &&
      token.name === "svg"
    ) {
      return true;
    }
    if (isHtmlIntegrationPoint(adjusted) &&
      (token.kind === "start-tag" || token.kind === "character")) {
      return true;
    }
    return token.kind === "eof";
  }

  #inForeignContent(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "character") {
      if (token.data.includes("\u0000")) {
        this.#parseErrorForEachCharacter(token, this.#insertionMode);
        this.#insertCharacter(Object.freeze({
          ...token,
          data: token.data.replaceAll("\u0000", "\uFFFD")
        }));
      } else {
        this.#insertCharacter(token);
        if (!isWhitespaceToken(token)) this.#framesetOk = false;
      }
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
      this.#parseError(token, this.#insertionMode);
      return null;
    }
    if (token.kind === "eof") return this.#process(this.#insertionMode, token, acknowledge);
    const breaksOut =
      (token.kind === "start-tag" &&
        (isForeignBreakoutStartTag(token.name) || hasForeignBreakoutFontAttribute(token))) ||
      (token.kind === "end-tag" && (token.name === "br" || token.name === "p"));
    if (breaksOut) {
      this.#parseError(token, this.#insertionMode);
      while (
        this.#currentNode().namespaceUri !== HTML_NAMESPACE &&
        !isMathMLTextIntegrationPoint(this.#currentNode()) &&
        !isHtmlIntegrationPoint(this.#currentNode())
      ) {
        this.#popCurrent();
      }
      return this.#process(this.#insertionMode, token, acknowledge);
    }

    if (token.kind === "start-tag") {
      const namespaceUri = this.#adjustedCurrentNode().namespaceUri;
      if (namespaceUri === HTML_NAMESPACE) {
        failInternalState("TREE_BUILDER_FOREIGN_NAMESPACE_MISSING");
      }
      this.#insertForeignElement(token, namespaceUri);
      if (token.selfClosing) {
        this.#popCurrent();
        acknowledge();
      }
      return null;
    }

    if (
      token.name === "script" &&
      this.#currentNode().namespaceUri === SVG_NAMESPACE &&
      this.#currentNode().localName === "script"
    ) {
      this.#popCurrent();
      return null;
    }

    let index = this.#openElements.length - 1;
    let node = this.#currentNode();
    if (node.localName.toLowerCase() !== token.name) {
      this.#parseError(token, this.#insertionMode);
    }
    for (;;) {
      if (index === 0) return null;
      if (node.localName.toLowerCase() === token.name) {
        this.#popThroughElement(node);
        return null;
      }
      index -= 1;
      node = requireInternalValue(
        this.#openElements.at(index),
        "TREE_BUILDER_STACK_ENTRY_MISSING"
      );
      if (node.namespaceUri === HTML_NAMESPACE) {
        if (index === 0) return null;
        return this.#process(this.#insertionMode, token, acknowledge);
      }
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
        sourceSpan: this.#retainNodeSpans ? token.span : null
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
    if (token.kind === "character" && isWhitespaceToken(token)) {
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
      if (token.name === "template") {
        this.#insertElement(token);
        this.#activeFormatting.pushMarker();
        this.#framesetOk = false;
        this.#templateInsertionModes.push("in-template");
        this.#setInsertionMode("in-template", token);
        return null;
      }
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
      if (token.name === "template") {
        this.#closeTemplate(token);
        return null;
      }
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
    if (token.kind === "character" && isWhitespaceToken(token)) {
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
      if (token.name === "frameset") {
        this.#insertElement(token);
        this.#setInsertionMode("in-frameset", token);
        return null;
      }
      if (HEAD_BODY_DELEGATE_TAGS.has(token.name)) {
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
      if (token.name === "template") return this.#inHead(token, acknowledge);
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
      if (this.#hasOpenHtmlElement("template")) {
        return "in-template";
      }
      if (this.#hasUnexpectedOpenElementAtBodyEnd()) this.#parseError(token, "in-body");
      this.#finish();
      return null;
    }
    if (token.kind === "start-tag") return this.#startTagInBody(token, acknowledge);
    return this.#endTagInBody(token, acknowledge);
  }

  #startTagInBody(token: HtmlStartTagToken, acknowledge: () => void): InsertionMode | null {
    const name = token.name;
    if (name === "html") {
      this.#parseError(token, "in-body");
      if (this.#hasOpenHtmlElement("template")) return null;
      const html = this.#openElements.at(0);
      if (html !== null) {
        this.#model.adoptAttributes(html, attributesFromToken(token.attributes, this.#retainNodeSpans));
      }
      return null;
    }
    if (HEAD_BODY_DELEGATE_TAGS.has(name)) {
      return this.#inHead(token, acknowledge);
    }
    if (name === "body") {
      this.#parseError(token, "in-body");
      if (this.#hasOpenHtmlElement("template")) return null;
      const body = this.#openElements.at(1);
      if (body?.localName === "body") {
        this.#framesetOk = false;
        this.#model.adoptAttributes(body, attributesFromToken(token.attributes, this.#retainNodeSpans));
      }
      return null;
    }
    if (name === "frameset") {
      this.#parseError(token, "in-body");
      const body = this.#openElements.at(1);
      if (body?.localName !== "body" || !this.#framesetOk) return null;
      this.#model.detach(body);
      while (this.#openElements.length > 1) this.#popCurrent();
      this.#insertElement(token);
      this.#setInsertionMode("in-frameset", token);
      return null;
    }
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
      const hasTemplate = this.#hasOpenHtmlElement("template");
      if (this.#formElement !== null && !hasTemplate) {
        this.#parseError(token, "in-body");
        return null;
      }
      this.#closeParagraphIfInButtonScope(token);
      const form = this.#insertElement(token);
      if (!hasTemplate) this.#formElement = form;
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
    if (name === "table") {
      if (this.#documentMode !== "quirks") this.#closeParagraphIfInButtonScope(token);
      this.#insertElement(token);
      this.#framesetOk = false;
      this.#setInsertionMode("in-table", token);
      return null;
    }
    if (name === "select") {
      if (this.#isHtmlFragmentContext("select")) {
        this.#parseError(token, "in-body");
        return null;
      }
      if (this.#hasInScope("select", "default")) {
        this.#parseError(token, "in-body");
        this.#popThrough("select");
        return null;
      }
      this.#reconstructActiveFormatting();
      this.#insertElement(token);
      this.#framesetOk = false;
      return null;
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
      if (this.#hasInScope("select", "default")) {
        this.#generateImpliedEndTags("optgroup");
        if (this.#hasInScope("option", "default")) this.#parseError(token, "in-body");
      } else if (this.#currentNode().localName === "option") {
        this.#popCurrent();
      }
      this.#reconstructActiveFormatting();
      this.#insertElement(token);
      return null;
    }
    if (name === "math" || name === "svg") {
      this.#reconstructActiveFormatting();
      this.#insertForeignElement(
        token,
        name === "math" ? MATHML_NAMESPACE : SVG_NAMESPACE
      );
      if (token.selfClosing) {
        this.#popCurrent();
        acknowledge();
      }
      return null;
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
      if (this.#isHtmlFragmentContext("select")) {
        this.#parseError(token, "in-body");
        return null;
      }
      if (this.#hasInScope("select", "default")) {
        this.#parseError(token, "in-body");
        this.#popThrough("select");
      }
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
      if (this.#hasInScope("select", "default")) {
        this.#generateImpliedEndTags();
        if (this.#hasInScope("option", "default") || this.#hasInScope("optgroup", "default")) {
          this.#parseError(token, "in-body");
        }
      }
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
    if (name === "template") return this.#inHead(token, acknowledge);
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
      if (this.#hasOpenHtmlElement("template")) {
        if (!this.#hasInScope("form", "default")) {
          this.#parseError(token, "in-body");
          return null;
        }
        this.#generateImpliedEndTags();
        if (this.#currentNode().localName !== "form") this.#parseError(token, "in-body");
        this.#popThrough("form");
        return null;
      }
      const form = this.#formElement;
      this.#formElement = null;
      if (
        form === null ||
        !this.#openElements.hasElementInScope(
          form,
          DEFAULT_SCOPE_BOUNDARIES,
          FOREIGN_SCOPE_BOUNDARIES
        )
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

  #inTable(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (
      token.kind === "character" &&
      TABLE_CHARACTER_CURRENT_TAGS.has(this.#currentNode().localName)
    ) {
      this.#pendingTableCharacters = [];
      this.#originalInsertionMode = this.#insertionMode;
      this.#setInsertionMode("in-table-text", token);
      return "in-table-text";
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
      this.#parseError(token, "in-table");
      return null;
    }
    if (token.kind === "start-tag") {
      const name = token.name;
      if (name === "caption") {
        this.#clearStackToTableContext();
        this.#activeFormatting.pushMarker();
        this.#insertElement(token);
        this.#setInsertionMode("in-caption", token);
        return null;
      }
      if (name === "colgroup") {
        this.#clearStackToTableContext();
        this.#insertElement(token);
        this.#setInsertionMode("in-column-group", token);
        return null;
      }
      if (name === "col") {
        this.#clearStackToTableContext();
        this.#insertElement(syntheticStartTag("colgroup", token), false);
        this.#setInsertionMode("in-column-group", token);
        return "in-column-group";
      }
      if (TABLE_BODY_TAGS.has(name)) {
        this.#clearStackToTableContext();
        this.#insertElement(token);
        this.#setInsertionMode("in-table-body", token);
        return null;
      }
      if (name === "td" || name === "th" || name === "tr") {
        this.#clearStackToTableContext();
        this.#insertElement(syntheticStartTag("tbody", token), false);
        this.#setInsertionMode("in-table-body", token);
        return "in-table-body";
      }
      if (name === "table") {
        this.#parseError(token, "in-table");
        if (!this.#hasInTableScope("table")) return null;
        this.#popThrough("table");
        this.#resetInsertionMode(token);
        return this.#insertionMode;
      }
      if (name === "style" || name === "script" || name === "template") {
        return this.#inHead(token, acknowledge);
      }
      if (name === "input") {
        const type = token.attributes.find((attribute) => attribute.name === "type")?.value;
        if (type?.toLowerCase() === "hidden") {
          this.#parseError(token, "in-table");
          this.#insertElement(token);
          this.#popCurrent();
          if (token.selfClosing) acknowledge();
          return null;
        }
      }
      if (name === "form") {
        this.#parseError(token, "in-table");
        if (this.#hasOpenHtmlElement("template") || this.#formElement !== null) return null;
        this.#formElement = this.#insertElement(token);
        this.#popCurrent();
        return null;
      }
    }
    if (token.kind === "end-tag") {
      if (token.name === "table") {
        if (!this.#hasInTableScope("table")) {
          this.#parseError(token, "in-table");
          return null;
        }
        this.#popThrough("table");
        this.#resetInsertionMode(token);
        return null;
      }
      if (token.name === "template") return this.#inHead(token, acknowledge);
      if (TABLE_IGNORED_END_TAGS.has(token.name)) {
        this.#parseError(token, "in-table");
        return null;
      }
    }
    if (token.kind === "eof") return this.#inBody(token, acknowledge);
    return this.#processTableAnythingElse(token, acknowledge);
  }

  #inTableText(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "character") {
      if (token.data === "\u0000") {
        this.#parseError(token, "in-table-text");
        return null;
      }
      this.#pendingTableCharacters.push(token);
      return null;
    }

    const original = requireInternalValue(
      this.#originalInsertionMode,
      "TREE_BUILDER_ORIGINAL_MODE_MISSING"
    );
    const pending = this.#pendingTableCharacters;
    this.#pendingTableCharacters = [];
    this.#setInsertionMode(original, token);
    this.#originalInsertionMode = null;
    if (pending.some((character) => !isWhitespaceToken(character))) {
      for (const character of pending) this.#parseErrorForEachCharacter(character, "in-table-text");
      for (const character of pending) this.#processWithFosterParenting(character, acknowledge);
    } else {
      for (const character of pending) this.#insertCharacter(character);
    }
    return original;
  }

  #inCaption(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "end-tag" && token.name === "caption") {
      if (!this.#hasInTableScope("caption")) {
        this.#parseError(token, "in-caption");
        return null;
      }
      this.#closeCaption(token);
      return null;
    }
    if (
      (token.kind === "start-tag" && CAPTION_BREAKOUT_START_TAGS.has(token.name)) ||
      (token.kind === "end-tag" && token.name === "table")
    ) {
      if (!this.#hasInTableScope("caption")) {
        this.#parseError(token, "in-caption");
        return null;
      }
      this.#closeCaption(token);
      return "in-table";
    }
    if (
      token.kind === "end-tag" &&
      CAPTION_IGNORED_END_TAGS.has(token.name)
    ) {
      this.#parseError(token, "in-caption");
      return null;
    }
    return this.#inBody(token, acknowledge);
  }

  #inColumnGroup(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "character" && isWhitespaceToken(token)) {
      this.#insertCharacter(token);
      return null;
    }
    if (token.kind === "character" && this.#currentNode().localName !== "colgroup") {
      this.#parseErrorForEachCharacter(token, "in-column-group");
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
      this.#parseError(token, "in-column-group");
      return null;
    }
    if (token.kind === "start-tag") {
      if (token.name === "html") return this.#inBody(token, acknowledge);
      if (token.name === "col") {
        this.#insertElement(token);
        this.#popCurrent();
        if (token.selfClosing) acknowledge();
        return null;
      }
      if (token.name === "template") return this.#inHead(token, acknowledge);
    }
    if (token.kind === "end-tag") {
      if (token.name === "colgroup") {
        if (this.#currentNode().localName !== "colgroup") {
          this.#parseError(token, "in-column-group");
          return null;
        }
        this.#popCurrent();
        this.#setInsertionMode("in-table", token);
        return null;
      }
      if (token.name === "col") {
        this.#parseError(token, "in-column-group");
        return null;
      }
      if (token.name === "template") return this.#inHead(token, acknowledge);
    }
    if (token.kind === "eof") return this.#inBody(token, acknowledge);
    if (this.#currentNode().localName !== "colgroup") {
      this.#parseError(token, "in-column-group");
      return null;
    }
    this.#popCurrent();
    this.#setInsertionMode("in-table", token);
    return "in-table";
  }

  #inTableBody(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "start-tag") {
      if (token.name === "tr") {
        this.#clearStackToTableBodyContext();
        this.#insertElement(token);
        this.#setInsertionMode("in-row", token);
        return null;
      }
      if (token.name === "td" || token.name === "th") {
        this.#parseError(token, "in-table-body");
        this.#clearStackToTableBodyContext();
        this.#insertElement(syntheticStartTag("tr", token), false);
        this.#setInsertionMode("in-row", token);
        return "in-row";
      }
      if (TABLE_BODY_BREAKOUT_START_TAGS.has(token.name)) {
        return this.#closeTableBodyAndReprocess(token);
      }
    }
    if (token.kind === "end-tag") {
      if (TABLE_BODY_TAGS.has(token.name)) {
        if (!this.#hasInTableScope(token.name)) {
          this.#parseError(token, "in-table-body");
          return null;
        }
        this.#clearStackToTableBodyContext();
        this.#popCurrent();
        this.#setInsertionMode("in-table", token);
        return null;
      }
      if (token.name === "table") return this.#closeTableBodyAndReprocess(token);
      if (TABLE_BODY_IGNORED_END_TAGS.has(token.name)) {
        this.#parseError(token, "in-table-body");
        return null;
      }
    }
    return this.#inTable(token, acknowledge);
  }

  #inRow(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "start-tag") {
      if (TABLE_CELL_TAGS.has(token.name)) {
        this.#clearStackToTableRowContext();
        this.#insertElement(token);
        this.#activeFormatting.pushMarker();
        this.#setInsertionMode("in-cell", token);
        return null;
      }
      if (ROW_BREAKOUT_START_TAGS.has(token.name)) {
        return this.#closeRowAndReprocess(token);
      }
    }
    if (token.kind === "end-tag") {
      if (token.name === "tr") {
        if (!this.#hasInTableScope("tr")) {
          this.#parseError(token, "in-row");
          return null;
        }
        this.#clearStackToTableRowContext();
        this.#popCurrent();
        this.#setInsertionMode("in-table-body", token);
        return null;
      }
      if (token.name === "table") return this.#closeRowAndReprocess(token);
      if (TABLE_BODY_TAGS.has(token.name)) {
        if (!this.#hasInTableScope(token.name)) {
          this.#parseError(token, "in-row");
          return null;
        }
        if (!this.#hasInTableScope("tr")) return null;
        return this.#closeRowAndReprocess(token);
      }
      if (ROW_IGNORED_END_TAGS.has(token.name)) {
        this.#parseError(token, "in-row");
        return null;
      }
    }
    return this.#inTable(token, acknowledge);
  }

  #inCell(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "end-tag" && TABLE_CELL_TAGS.has(token.name)) {
      if (!this.#hasInTableScope(token.name)) {
        this.#parseError(token, "in-cell");
        return null;
      }
      this.#closeCell(token);
      return null;
    }
    if (
      (token.kind === "start-tag" && CELL_BREAKOUT_START_TAGS.has(token.name)) ||
      (token.kind === "end-tag" && CELL_BREAKOUT_END_TAGS.has(token.name))
    ) {
      if (token.kind === "end-tag" && !this.#hasInTableScope(token.name)) {
        this.#parseError(token, "in-cell");
        return null;
      }
      if (!this.#hasInTableScope("td") && !this.#hasInTableScope("th")) {
        this.#parseError(token, "in-cell");
        return null;
      }
      this.#closeCell(token);
      return this.#insertionMode;
    }
    if (
      token.kind === "end-tag" &&
      CELL_IGNORED_END_TAGS.has(token.name)
    ) {
      this.#parseError(token, "in-cell");
      return null;
    }
    return this.#inBody(token, acknowledge);
  }

  #inTemplate(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (
      token.kind === "character" || token.kind === "comment" ||
      token.kind === "processing-instruction" || token.kind === "doctype"
    ) return this.#inBody(token, acknowledge);
    if (token.kind === "start-tag") {
      if (TEMPLATE_HEAD_START_TAGS.has(token.name)) {
        return this.#inHead(token, acknowledge);
      }
      if (TEMPLATE_TABLE_START_TAGS.has(token.name)) {
        this.#replaceTemplateMode("in-table", token);
        return "in-table";
      }
      if (token.name === "col") {
        this.#replaceTemplateMode("in-column-group", token);
        return "in-column-group";
      }
      if (token.name === "tr") {
        this.#replaceTemplateMode("in-table-body", token);
        return "in-table-body";
      }
      if (token.name === "td" || token.name === "th") {
        this.#replaceTemplateMode("in-row", token);
        return "in-row";
      }
      this.#replaceTemplateMode("in-body", token);
      return "in-body";
    }
    if (token.kind === "end-tag") {
      if (token.name === "template") return this.#inHead(token, acknowledge);
      this.#parseError(token, "in-template");
      return null;
    }
    if (!this.#hasOpenHtmlElement("template")) {
      this.#finish();
      return null;
    }
    this.#parseError(token, "in-template");
    this.#popThrough("template");
    this.#clearFormattingToMarker();
    this.#popTemplateMode();
    this.#resetInsertionMode(token);
    return this.#insertionMode;
  }

  #inFrameset(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "character" && isWhitespaceToken(token)) {
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
      this.#parseError(token, "in-frameset");
      return null;
    }
    if (token.kind === "start-tag") {
      if (token.name === "html") return this.#inBody(token, acknowledge);
      if (token.name === "frameset") {
        this.#insertElement(token);
        return null;
      }
      if (token.name === "frame") {
        this.#insertElement(token);
        this.#popCurrent();
        if (token.selfClosing) acknowledge();
        return null;
      }
      if (token.name === "noframes") return this.#inHead(token, acknowledge);
    }
    if (token.kind === "end-tag" && token.name === "frameset") {
      if (this.#currentNode().localName === "html") {
        this.#parseError(token, "in-frameset");
        return null;
      }
      this.#popCurrent();
      if (this.#fragmentContext === null && this.#currentNode().localName !== "frameset") {
        this.#setInsertionMode("after-frameset", token);
      }
      return null;
    }
    if (token.kind === "eof") {
      if (this.#currentNode().localName !== "html") this.#parseError(token, "in-frameset");
      this.#finish();
      return null;
    }
    if (token.kind === "character") this.#parseErrorForEachCharacter(token, "in-frameset");
    else this.#parseError(token, "in-frameset");
    return null;
  }

  #inAfterFrameset(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (isWhitespaceToken(token)) return this.#inBody(token, acknowledge);
    if (token.kind === "comment") {
      this.#insertComment(token);
      return null;
    }
    if (token.kind === "processing-instruction") {
      this.#insertProcessingInstruction(token);
      return null;
    }
    if (token.kind === "doctype") {
      this.#parseError(token, "after-frameset");
      return null;
    }
    if (token.kind === "start-tag" && token.name === "html") return this.#inBody(token, acknowledge);
    if (token.kind === "start-tag" && token.name === "noframes") return this.#inHead(token, acknowledge);
    if (token.kind === "end-tag" && token.name === "html") {
      this.#setInsertionMode("after-after-frameset", token);
      return null;
    }
    if (token.kind === "eof") {
      this.#finish();
      return null;
    }
    if (token.kind === "character") this.#parseErrorForEachCharacter(token, "after-frameset");
    else this.#parseError(token, "after-frameset");
    return null;
  }

  #inAfterAfterFrameset(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "comment") {
      this.#insertComment(token, this.#model.root);
      return null;
    }
    if (token.kind === "processing-instruction") {
      this.#insertProcessingInstruction(token, this.#model.root);
      return null;
    }
    if (
      token.kind === "doctype" || isWhitespaceToken(token) ||
      (token.kind === "start-tag" && token.name === "html")
    ) return this.#inBody(token, acknowledge);
    if (token.kind === "start-tag" && token.name === "noframes") return this.#inHead(token, acknowledge);
    if (token.kind === "eof") {
      this.#finish();
      return null;
    }
    if (token.kind === "character") {
      this.#parseErrorForEachCharacter(token, "after-after-frameset");
    } else {
      this.#parseError(token, "after-after-frameset");
    }
    return null;
  }

  #inAfterBody(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (isWhitespaceToken(token)) return this.#inBody(token, acknowledge);
    if (token.kind === "comment") {
      const html = requireInternalValue(this.#openElements.at(0), "TREE_BUILDER_STACK_ENTRY_MISSING");
      this.#insertComment(token, this.#fragmentContext === null ? html : this.#model.root);
      return null;
    }
    if (token.kind === "processing-instruction") {
      const html = requireInternalValue(this.#openElements.at(0), "TREE_BUILDER_STACK_ENTRY_MISSING");
      this.#insertProcessingInstruction(token, this.#fragmentContext === null ? html : this.#model.root);
      return null;
    }
    if (token.kind === "doctype") {
      this.#parseError(token, "after-body");
      return null;
    }
    if (token.kind === "start-tag" && token.name === "html") return this.#inBody(token, acknowledge);
    if (token.kind === "end-tag" && token.name === "html") {
      if (this.#fragmentContext !== null) {
        this.#parseError(token, "after-body");
        return null;
      }
      this.#setInsertionMode("after-after-body", token);
      return null;
    }
    if (token.kind === "eof") {
      this.#finish();
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
      this.#finish();
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
      attributes: attributesFromToken(token.attributes, this.#retainNodeSpans),
      sourceSpan: this.#retainNodeSpans ? token.span : null
    });
  }

  #createForeignElement(
    token: HtmlStartTagToken,
    namespaceUri: typeof MATHML_NAMESPACE | typeof SVG_NAMESPACE
  ): HtmlTreeElement {
    const localName = adjustedForeignTagName(token.name, namespaceUri);
    return this.#model.createElement({
      namespaceUri,
      prefix: null,
      localName,
      qualifiedName: localName,
      attributes: adjustedForeignAttributes(token.attributes, namespaceUri).map((attribute) => ({
        ...attribute,
        sourceSpan: this.#retainNodeSpans ? attribute.sourceSpan ?? null : null
      })),
      sourceSpan: this.#retainNodeSpans ? token.span : null
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
    this.#selectElements.elementInserted(element);
    this.#openElements.push(element);
    return element;
  }

  #insertForeignElement(
    token: HtmlStartTagToken,
    namespaceUri: typeof MATHML_NAMESPACE | typeof SVG_NAMESPACE
  ): HtmlTreeElement {
    const element = this.#createForeignElement(token, namespaceUri);
    this.#insertAtAppropriateLocation(element);
    this.#openElements.push(element);
    return element;
  }

  #insertAtAppropriateLocation(node: HtmlTreeNode, overrideTarget?: HtmlTreeElement): void {
    const location = this.#adjustedInsertionLocation(overrideTarget);
    this.#model.insertBefore(location.parent, node, location.before);
  }

  #adjustedInsertionLocation(overrideTarget?: HtmlTreeElement): InsertionLocation {
    const location = this.#appropriateInsertionLocation(overrideTarget);
    const first = this.#openElements.at(0);
    if (
      this.#fragmentContext !== null &&
      first !== null &&
      location.parent === first
    ) {
      return { parent: this.#model.root, before: null };
    }
    return location;
  }

  #appropriateInsertionLocation(overrideTarget?: HtmlTreeElement): InsertionLocation {
    if (this.#openElements.length === 0) {
      return { parent: this.#model.root, before: null };
    }
    const target = overrideTarget ?? this.#currentNode();
    if (
      !this.#fosterParenting ||
      target.namespaceUri !== HTML_NAMESPACE ||
      !FOSTER_PARENTING_TARGET_TAGS.has(target.localName)
    ) {
      return { parent: target, before: null };
    }

    let lastTemplateIndex = -1;
    let lastTableIndex = -1;
    for (let index = this.#openElements.length - 1; index >= 0; index -= 1) {
      this.#resources.checkpoint();
      const element = this.#openElements.at(index);
      if (element?.namespaceUri !== HTML_NAMESPACE) continue;
      if (lastTemplateIndex < 0 && element.localName === "template") lastTemplateIndex = index;
      if (lastTableIndex < 0 && element.localName === "table") lastTableIndex = index;
      if (lastTemplateIndex >= 0 && lastTableIndex >= 0) break;
    }
    if (lastTemplateIndex > lastTableIndex) {
      const template = requireInternalValue(
        this.#openElements.at(lastTemplateIndex),
        "TREE_BUILDER_STACK_ENTRY_MISSING"
      );
      return { parent: template, before: null };
    }
    if (lastTableIndex < 0) {
      const first = requireInternalValue(
        this.#openElements.at(0),
        "TREE_BUILDER_STACK_ENTRY_MISSING"
      );
      return { parent: first, before: null };
    }
    const table = requireInternalValue(
      this.#openElements.at(lastTableIndex),
      "TREE_BUILDER_STACK_ENTRY_MISSING"
    );
    if (table.parent !== null) return { parent: table.parent, before: table };
    const previous = requireInternalValue(
      this.#openElements.at(lastTableIndex - 1),
      "TREE_BUILDER_STACK_ENTRY_MISSING"
    );
    return { parent: previous, before: null };
  }

  #insertCharacter(token: Extract<HtmlToken, { readonly kind: "character" }>): void {
    const location = this.#adjustedInsertionLocation();
    this.#model.insertText(
      location.parent,
      token.data,
      this.#retainNodeSpans ? token.span : null,
      location.before
    );
  }

  #insertComment(
    token: Extract<HtmlToken, { readonly kind: "comment" }>,
    parent?: HtmlTreeParent
  ): void {
    const comment = this.#model.createComment(
      token.data,
      this.#retainNodeSpans ? token.span : null
    );
    if (parent !== undefined) this.#model.append(parent, comment);
    else this.#insertAtAppropriateLocation(comment);
  }

  #insertProcessingInstruction(
    token: Extract<HtmlToken, { readonly kind: "processing-instruction" }>,
    parent?: HtmlTreeParent
  ): void {
    const instruction = this.#model.createProcessingInstruction(
      token.target,
      token.data,
      this.#retainNodeSpans ? token.span : null
    );
    if (parent !== undefined) this.#model.append(parent, instruction);
    else this.#insertAtAppropriateLocation(instruction);
  }

  #insertTextElement(token: HtmlStartTagToken, tokenizerMode: TokenizerMode): void {
    this.#insertElement(token);
    this.#tokenizerControl().setMode(tokenizerMode);
    this.#originalInsertionMode = this.#insertionMode;
    this.#setInsertionMode("text", token);
  }

  #setInsertionMode(to: InsertionMode, token: HtmlToken | null): void {
    const from = this.#insertionMode;
    if (from === to) return;
    this.#insertionMode = to;
    if (token !== null) {
      this.#observer?.onInsertionModeTransition?.(Object.freeze({
        from,
        to,
        token: Object.freeze({ kind: token.kind, tagName: tokenTagName(token), span: token.span })
      }));
    }
    this.#resources.ensureActive();
  }

  #parseError(token: HtmlToken, insertionMode: InsertionMode): void {
    this.#resources.reserveParseError();
    const error = createTreeBuilderParseError(insertionMode, token);
    this.#onParseError(error);
    this.#observer?.onParseError?.(error);
    this.#resources.ensureActive();
  }

  #parseErrorForEachCharacter(token: HtmlCharacterToken, insertionMode: InsertionMode): void {
    for (let offset = 0; offset < token.data.length;) {
      const codePoint = token.data.codePointAt(offset);
      this.#parseError(token, insertionMode);
      offset += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    }
  }

  #tokenizerControl(): TokenizerControl {
    return requireInternalValue(this.#tokenizer, "TREE_BUILDER_TOKENIZER_NOT_CONNECTED");
  }

  #currentNode(): HtmlTreeElement {
    return this.#openElements.current();
  }

  #adjustedCurrentNode(): HtmlTreeElement {
    return this.#fragmentContext !== null && this.#openElements.length === 1
      ? this.#fragmentContext
      : this.#currentNode();
  }

  #isHtmlFragmentContext(localName: string): boolean {
    return this.#fragmentContext?.namespaceUri === HTML_NAMESPACE &&
      this.#fragmentContext.localName === localName;
  }

  #updateTokenizerForeignContext(): void {
    this.#tokenizerControl().setForeignContent(
      this.#openElements.length > 0 &&
      this.#adjustedCurrentNode().namespaceUri !== HTML_NAMESPACE
    );
  }

  #popCurrent(): HtmlTreeElement {
    const current = this.#currentNode();
    this.#closeSourceSpan(current);
    this.#selectElements.optionPopped(current);
    return this.#openElements.pop();
  }

  #finish(): void {
    for (let index = this.#openElements.length - 1; index >= 0; index -= 1) {
      const element = requireInternalValue(
        this.#openElements.at(index),
        "TREE_BUILDER_STACK_ENTRY_MISSING"
      );
      this.#closeSourceSpan(element);
      this.#selectElements.optionPopped(element);
    }
    this.#finished = true;
  }

  #popThrough(name: string): void {
    for (;;) {
      const popped = this.#popCurrent();
      if (popped.namespaceUri === HTML_NAMESPACE && popped.localName === name) return;
    }
  }

  #popThroughElement(element: HtmlTreeElement): void {
    for (;;) {
      if (this.#popCurrent() === element) return;
    }
  }

  #removeOpenElement(element: HtmlTreeElement): void {
    this.#closeSourceSpan(element);
    this.#openElements.remove(element);
  }

  #closeSourceSpan(element: HtmlTreeElement): void {
    const current = element.sourceSpan;
    const token = requireInternalValue(this.#activeToken, "TREE_BUILDER_ACTIVE_TOKEN_MISSING");
    if (current === null) return;
    const explicitMatch = token.kind === "end-tag" &&
      element.localName.toLowerCase() === token.name;
    const end = explicitMatch || token.kind === "eof"
      ? token.span.endUtf16Offset
      : token.span.startUtf16Offset;
    if (end > current.endUtf16Offset) {
      this.#model.setSourceSpan(element, sourceSpan(current.startUtf16Offset, end));
    }
  }

  #generateImpliedEndTags(except: string | null = null): void {
    while (
      this.#currentNode().namespaceUri === HTML_NAMESPACE &&
      IMPLIED_END_TAGS.has(this.#currentNode().localName) &&
      this.#currentNode().localName !== except
    ) {
      this.#popCurrent();
    }
  }

  #generateAllImpliedEndTagsThoroughly(): void {
    while (
      this.#currentNode().namespaceUri === HTML_NAMESPACE &&
      THOROUGH_IMPLIED_END_TAGS.has(this.#currentNode().localName)
    ) {
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
    return this.#openElements.hasInScope(
      HTML_NAMESPACE,
      name,
      boundaries,
      FOREIGN_SCOPE_BOUNDARIES
    );
  }

  #hasInTableScope(name: string): boolean {
    return this.#openElements.hasInScope(HTML_NAMESPACE, name, TABLE_SCOPE_BOUNDARIES);
  }

  #hasOpenHtmlElement(name: string): boolean {
    for (let index = this.#openElements.length - 1; index >= 0; index -= 1) {
      this.#resources.checkpoint();
      const element = this.#openElements.at(index);
      if (element === null) continue;
      if (element.namespaceUri === HTML_NAMESPACE && element.localName === name) return true;
    }
    return false;
  }

  #processTableAnythingElse(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    if (token.kind === "character") this.#parseErrorForEachCharacter(token, "in-table");
    else this.#parseError(token, "in-table");
    return this.#processWithFosterParenting(token, acknowledge);
  }

  #processWithFosterParenting(token: HtmlToken, acknowledge: () => void): InsertionMode | null {
    this.#fosterParenting = true;
    try {
      return this.#inBody(token, acknowledge);
    } finally {
      this.#fosterParenting = false;
    }
  }

  #clearStackToTableContext(): void {
    while (!TABLE_CONTEXT_CLEAR_TAGS.has(this.#currentNode().localName)) this.#popCurrent();
  }

  #clearStackToTableBodyContext(): void {
    while (!TABLE_BODY_CONTEXT_CLEAR_TAGS.has(this.#currentNode().localName)) this.#popCurrent();
  }

  #clearStackToTableRowContext(): void {
    while (!TABLE_ROW_CONTEXT_CLEAR_TAGS.has(this.#currentNode().localName)) this.#popCurrent();
  }

  #closeCaption(token: HtmlToken): void {
    this.#generateImpliedEndTags();
    if (this.#currentNode().localName !== "caption") this.#parseError(token, "in-caption");
    this.#popThrough("caption");
    this.#clearFormattingToMarker();
    this.#setInsertionMode("in-table", token);
  }

  #closeTableBodyAndReprocess(token: HtmlToken): InsertionMode | null {
    const group = this.#lastInTableScope(TABLE_BODY_TAGS);
    if (group === null) {
      this.#parseError(token, "in-table-body");
      return null;
    }
    this.#clearStackToTableBodyContext();
    this.#popCurrent();
    this.#setInsertionMode("in-table", token);
    return "in-table";
  }

  #closeRowAndReprocess(token: HtmlToken): InsertionMode | null {
    if (!this.#hasInTableScope("tr")) {
      this.#parseError(token, "in-row");
      return null;
    }
    this.#clearStackToTableRowContext();
    this.#popCurrent();
    this.#setInsertionMode("in-table-body", token);
    return "in-table-body";
  }

  #closeCell(token: HtmlToken): void {
    const cell = this.#lastInTableScope(TABLE_CELL_TAGS);
    if (cell === null) failInternalState("TREE_BUILDER_STACK_ENTRY_MISSING");
    this.#generateImpliedEndTags();
    if (this.#currentNode() !== cell) this.#parseError(token, "in-cell");
    this.#popThroughElement(cell);
    this.#clearFormattingToMarker();
    this.#setInsertionMode("in-row", token);
  }

  #lastInTableScope(names: ReadonlySet<string>): HtmlTreeElement | null {
    return this.#openElements.lastInScope(HTML_NAMESPACE, names, TABLE_SCOPE_BOUNDARIES);
  }

  #closeTemplate(token: HtmlToken): void {
    if (!this.#hasOpenHtmlElement("template")) {
      this.#parseError(token, "in-head");
      return;
    }
    this.#generateAllImpliedEndTagsThoroughly();
    if (this.#currentNode().localName !== "template") this.#parseError(token, "in-head");
    this.#popThrough("template");
    this.#clearFormattingToMarker();
    this.#popTemplateMode();
    this.#resetInsertionMode(token);
  }

  #replaceTemplateMode(mode: InsertionMode, token: HtmlToken): void {
    this.#popTemplateMode();
    this.#templateInsertionModes.push(mode);
    this.#setInsertionMode(mode, token);
  }

  #popTemplateMode(): InsertionMode {
    return requireInternalValue(
      this.#templateInsertionModes.pop(),
      "TREE_BUILDER_TEMPLATE_MODE_MISSING"
    );
  }

  #resetInsertionMode(token: HtmlToken | null): void {
    for (let index = this.#openElements.length - 1; index >= 0; index -= 1) {
      this.#resources.checkpoint();
      let node = requireInternalValue(
        this.#openElements.at(index),
        "TREE_BUILDER_STACK_ENTRY_MISSING"
      );
      const last = index === 0;
      if (last && this.#fragmentContext !== null) node = this.#fragmentContext;
      if (node.namespaceUri === HTML_NAMESPACE && !last && TABLE_CELL_TAGS.has(node.localName)) {
        this.#setInsertionMode("in-cell", token);
        return;
      }
      if (node.namespaceUri === HTML_NAMESPACE && node.localName === "tr") {
        this.#setInsertionMode("in-row", token);
        return;
      }
      if (node.namespaceUri === HTML_NAMESPACE && TABLE_BODY_TAGS.has(node.localName)) {
        this.#setInsertionMode("in-table-body", token);
        return;
      }
      if (node.namespaceUri === HTML_NAMESPACE && node.localName === "caption") {
        this.#setInsertionMode("in-caption", token);
        return;
      }
      if (node.namespaceUri === HTML_NAMESPACE && node.localName === "colgroup") {
        this.#setInsertionMode("in-column-group", token);
        return;
      }
      if (node.namespaceUri === HTML_NAMESPACE && node.localName === "table") {
        this.#setInsertionMode("in-table", token);
        return;
      }
      if (node.namespaceUri === HTML_NAMESPACE && node.localName === "template") {
        const mode = requireInternalValue(
          this.#templateInsertionModes.at(-1),
          "TREE_BUILDER_TEMPLATE_MODE_MISSING"
        );
        this.#setInsertionMode(mode, token);
        return;
      }
      if (node.namespaceUri === HTML_NAMESPACE && !last && node.localName === "head") {
        this.#setInsertionMode("in-head", token);
        return;
      }
      if (node.namespaceUri === HTML_NAMESPACE && node.localName === "body") {
        this.#setInsertionMode("in-body", token);
        return;
      }
      if (node.namespaceUri === HTML_NAMESPACE && node.localName === "frameset") {
        this.#setInsertionMode("in-frameset", token);
        return;
      }
      if (node.namespaceUri === HTML_NAMESPACE && node.localName === "html") {
        this.#setInsertionMode(this.#headElement === null ? "before-head" : "after-head", token);
        return;
      }
      if (last) {
        this.#setInsertionMode("in-body", token);
        return;
      }
    }
    failInternalState("TREE_BUILDER_STACK_ENTRY_MISSING");
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
      if (!this.#openElements.hasElementInScope(
        formattingElement,
        DEFAULT_SCOPE_BOUNDARIES,
        FOREIGN_SCOPE_BOUNDARIES
      )) {
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
      DEFAULT_SCOPE_BOUNDARIES,
      FOREIGN_SCOPE_BOUNDARIES
    );
  }

  #isSpecial(element: HtmlTreeElement): boolean {
    if (element.namespaceUri === HTML_NAMESPACE) return SPECIAL_HTML_ELEMENTS.has(element.localName);
    if (element.namespaceUri === MATHML_NAMESPACE) {
      return SPECIAL_MATHML_ELEMENTS.has(element.localName);
    }
    return SPECIAL_SVG_ELEMENTS.has(element.localName);
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
