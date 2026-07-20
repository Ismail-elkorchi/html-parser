import { requireInternalValue } from "../../foundation/internal-state-error.js";
import { sourceSpan, type SourceSpan } from "../positions.js";

import type { StartTagResourceGuard } from "../resource-guard.js";
import type {
  HtmlCommentToken,
  HtmlDoctypeToken,
  HtmlEndTagToken,
  HtmlProcessingInstructionToken,
  HtmlStartTagToken,
  HtmlTokenAttribute
} from "../tokens.js";

type DoctypeFieldMissingReason =
  | "TOKENIZER_DOCTYPE_NAME_MISSING"
  | "TOKENIZER_DOCTYPE_PUBLIC_IDENTIFIER_MISSING"
  | "TOKENIZER_DOCTYPE_SYSTEM_IDENTIFIER_MISSING";

const EMPTY_TOKEN_ATTRIBUTES: readonly HtmlTokenAttribute[] = Object.freeze([]);

function appendCodePoints(guard: StartTagResourceGuard, value: string): void {
  for (const codePoint of value) guard.appendCodePoint(codePoint);
}

class AttributeBuilder {
  readonly #guard: StartTagResourceGuard;
  readonly #start: number;
  #end: number;
  #nameBuffer = "";
  #nameEnd: number;
  #valueParts: string[] = [];
  #valueStart: number | null = null;
  #valueEnd: number | null = null;
  #valueExplicit = false;
  #valueCommitted = false;
  #name: string | null = null;
  #duplicate = false;

  constructor(start: number, guard: StartTagResourceGuard) {
    guard.beginAttribute();
    this.#guard = guard;
    this.#start = start;
    this.#end = start;
    this.#nameEnd = start;
  }

  appendName(value: string, span: SourceSpan): void {
    appendCodePoints(this.#guard, value);
    this.#nameBuffer += value;
    this.#nameEnd = span.endUtf16Offset;
    this.#end = span.endUtf16Offset;
  }

  finishName(existingNames: Set<string>): boolean {
    if (this.#name !== null) return false;
    this.#name = this.#nameBuffer;
    if (existingNames.has(this.#name)) {
      this.#duplicate = true;
      return true;
    }
    existingNames.add(this.#name);
    return false;
  }

  touch(span: SourceSpan): void {
    this.#end = span.endUtf16Offset;
  }

  beginQuotedValue(position: number): void {
    this.#valueExplicit = true;
    this.#valueCommitted = true;
    this.#valueStart = position;
    this.#valueEnd = position;
  }

  markValuePending(position: number): void {
    this.#valueExplicit = true;
    if (!this.#valueCommitted) {
      this.#valueStart = position;
      this.#valueEnd = position;
    }
  }

  ensureEmptyValue(position: number): void {
    this.#valueExplicit = true;
    if (!this.#valueCommitted) {
      this.#valueCommitted = true;
      this.#valueStart = position;
      this.#valueEnd = position;
    }
  }

  appendValue(value: string, span: SourceSpan): void {
    appendCodePoints(this.#guard, value);
    this.#valueExplicit = true;
    if (!this.#valueCommitted) {
      this.#valueCommitted = true;
      this.#valueStart = span.startUtf16Offset;
    }
    this.#valueEnd = span.endUtf16Offset;
    this.#end = span.endUtf16Offset;
    this.#valueParts.push(value);
  }

  finish(existingNames: Set<string>): HtmlTokenAttribute | null {
    this.finishName(existingNames);
    if (this.#duplicate) return null;
    const valueSpan = !this.#valueExplicit || this.#valueStart === null
      ? null
      : sourceSpan(this.#valueStart, this.#valueEnd ?? this.#valueStart);
    return Object.freeze({
      name: this.#name ?? "",
      value: this.#valueParts.join(""),
      span: sourceSpan(this.#start, this.#end),
      nameSpan: sourceSpan(this.#start, this.#nameEnd),
      valueSpan
    });
  }
}

export class TagTokenBuilder {
  readonly kind: "start-tag" | "end-tag";
  readonly startUtf16Offset: number;
  readonly #resource: StartTagResourceGuard;
  readonly #protectTokenObservation: boolean;
  #attributeNames: Set<string> | null = null;
  #name = "";
  #attributes: HtmlTokenAttribute[] = [];
  #currentAttribute: AttributeBuilder | null = null;
  #selfClosing = false;

  constructor(
    kind: "start-tag" | "end-tag",
    startUtf16Offset: number,
    resource: StartTagResourceGuard,
    protectTokenObservation = true
  ) {
    this.kind = kind;
    this.startUtf16Offset = startUtf16Offset;
    this.#resource = resource;
    this.#protectTokenObservation = protectTokenObservation;
  }

  appendName(value: string): void {
    this.#name += value;
  }

  name(): string {
    return this.#name;
  }

  beginAttribute(startUtf16Offset: number): void {
    this.finishAttribute();
    this.#attributeNames ??= new Set<string>();
    this.#currentAttribute = new AttributeBuilder(startUtf16Offset, this.#resource);
  }

  appendAttributeName(value: string, span: SourceSpan): void {
    this.#requireAttribute().appendName(value, span);
  }

  finishAttributeName(): boolean {
    return this.#requireAttribute().finishName(
      requireInternalValue(this.#attributeNames, "TOKENIZER_CURRENT_ATTRIBUTE_MISSING")
    );
  }

  touchAttribute(span: SourceSpan): void {
    this.#requireAttribute().touch(span);
  }

  beginQuotedAttributeValue(position: number): void {
    this.#requireAttribute().beginQuotedValue(position);
  }

  markAttributeValuePending(position: number): void {
    this.#requireAttribute().markValuePending(position);
  }

  ensureEmptyAttributeValue(position: number): void {
    this.#requireAttribute().ensureEmptyValue(position);
  }

  appendAttributeValue(value: string, span: SourceSpan): void {
    this.#requireAttribute().appendValue(value, span);
  }

  finishAttribute(): void {
    if (this.#currentAttribute === null) return;
    const attribute = this.#currentAttribute.finish(
      requireInternalValue(this.#attributeNames, "TOKENIZER_CURRENT_ATTRIBUTE_MISSING")
    );
    if (attribute !== null) this.#attributes.push(attribute);
    this.#currentAttribute = null;
  }

  setSelfClosing(): void {
    this.#selfClosing = true;
  }

  toToken(endUtf16Offset: number): HtmlStartTagToken | HtmlEndTagToken {
    this.finishAttribute();
    const name = this.#name;
    const attributes = this.#attributes.length === 0
      ? EMPTY_TOKEN_ATTRIBUTES
      : Object.freeze(this.#attributes);
    const span = sourceSpan(this.startUtf16Offset, endUtf16Offset);
    const token: HtmlStartTagToken | HtmlEndTagToken = this.kind === "start-tag"
      ? { kind: "start-tag", name, attributes, selfClosing: this.#selfClosing, span }
      : { kind: "end-tag", name, attributes, selfClosing: this.#selfClosing, span };
    return this.#protectTokenObservation ? Object.freeze(token) : token;
  }

  #requireAttribute(): AttributeBuilder {
    return requireInternalValue(this.#currentAttribute, "TOKENIZER_CURRENT_ATTRIBUTE_MISSING");
  }
}

export class CommentTokenBuilder {
  readonly #startUtf16Offset: number;
  #parts: string[];

  constructor(startUtf16Offset: number, initialData = "") {
    this.#startUtf16Offset = startUtf16Offset;
    this.#parts = initialData.length === 0 ? [] : [initialData];
  }

  append(value: string): void {
    this.#parts.push(value);
  }

  toToken(endUtf16Offset: number): HtmlCommentToken {
    const token = Object.freeze({
      kind: "comment",
      data: this.#parts.join(""),
      span: sourceSpan(this.#startUtf16Offset, endUtf16Offset)
    } as const);
    this.#parts = [];
    return token;
  }
}

export class ProcessingInstructionTokenBuilder {
  readonly #startUtf16Offset: number;
  readonly #target: string;
  #dataParts: string[] = [];

  constructor(startUtf16Offset: number, target: string) {
    this.#startUtf16Offset = startUtf16Offset;
    this.#target = target;
  }

  appendData(value: string): void {
    this.#dataParts.push(value);
  }

  toToken(endUtf16Offset: number): HtmlProcessingInstructionToken {
    const token = Object.freeze({
      kind: "processing-instruction",
      target: this.#target,
      data: this.#dataParts.join(""),
      span: sourceSpan(this.#startUtf16Offset, endUtf16Offset)
    } as const);
    this.#dataParts = [];
    return token;
  }
}

export class DoctypeTokenBuilder {
  readonly #startUtf16Offset: number;
  #nameParts: string[] | null = null;
  #publicIdentifierParts: string[] | null = null;
  #systemIdentifierParts: string[] | null = null;
  #forceQuirks = false;

  constructor(startUtf16Offset: number) {
    this.#startUtf16Offset = startUtf16Offset;
  }

  startName(value = ""): void {
    this.#nameParts = value.length === 0 ? [] : [value];
  }

  appendName(value: string): void {
    this.#requireParts(this.#nameParts, "TOKENIZER_DOCTYPE_NAME_MISSING").push(value);
  }

  startPublicIdentifier(): void {
    this.#publicIdentifierParts = [];
  }

  appendPublicIdentifier(value: string): void {
    this.#requireParts(
      this.#publicIdentifierParts,
      "TOKENIZER_DOCTYPE_PUBLIC_IDENTIFIER_MISSING"
    ).push(value);
  }

  startSystemIdentifier(): void {
    this.#systemIdentifierParts = [];
  }

  appendSystemIdentifier(value: string): void {
    this.#requireParts(
      this.#systemIdentifierParts,
      "TOKENIZER_DOCTYPE_SYSTEM_IDENTIFIER_MISSING"
    ).push(value);
  }

  forceQuirks(): void {
    this.#forceQuirks = true;
  }

  toToken(endUtf16Offset: number): HtmlDoctypeToken {
    return Object.freeze({
      kind: "doctype",
      name: this.#nameParts?.join("") ?? null,
      publicIdentifier: this.#publicIdentifierParts?.join("") ?? null,
      systemIdentifier: this.#systemIdentifierParts?.join("") ?? null,
      forceQuirks: this.#forceQuirks,
      span: sourceSpan(this.#startUtf16Offset, endUtf16Offset)
    });
  }

  #requireParts(parts: string[] | null, reason: DoctypeFieldMissingReason): string[] {
    return requireInternalValue(parts, reason);
  }
}
