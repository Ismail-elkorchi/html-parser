import { getNamedCharacterReference } from "../entities.js";

import type {
  CharacterToken,
  HtmlToken,
  TokenizeOptions,
  TokenizeResult,
  TokenizerDebugSnapshot,
  TokenizerParseError,
  TokenizerState
} from "./tokens.js";

const WINDOWS_1252_OVERRIDES: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178
};

function isAsciiAlpha(char: string): boolean {
  return /^[A-Za-z]$/.test(char);
}

function isTagNameChar(char: string): boolean {
  return /^[A-Za-z0-9:-]$/.test(char);
}

function isWhitespace(char: string): boolean {
  return /^[\t\n\f\r ]$/.test(char);
}

function stableAttributeRecord(attributes: Array<readonly [string, string]>): Readonly<Record<string, string>> {
  const sorted = [...attributes].sort((left, right) => left[0].localeCompare(right[0]));
  const record: Record<string, string> = {};

  for (const [name, value] of sorted) {
    if (record[name] !== undefined) {
      continue;
    }
    record[name] = value;
  }

  return Object.freeze(record);
}

class TokenizerRuntime {
  readonly input: string;
  readonly options: TokenizeOptions;
  readonly startedAt: number;
  readonly tokens: HtmlToken[] = [];
  readonly errors: TokenizerParseError[] = [];
  state: TokenizerState = "Data";
  index = 0;
  textBytes = 0;

  constructor(input: string, options: TokenizeOptions) {
    this.input = input;
    this.options = options;
    this.startedAt = Date.now();
  }

  addError(code: string, index: number): void {
    const maxParseErrors = this.options.budgets?.maxParseErrors;
    if (maxParseErrors !== undefined && this.errors.length >= maxParseErrors) {
      return;
    }

    this.errors.push({ code, index });
  }

  enforceTimeBudget(): void {
    const maxTimeMs = this.options.budgets?.maxTimeMs;
    if (maxTimeMs === undefined) {
      return;
    }

    if (Date.now() - this.startedAt > maxTimeMs) {
      this.addError("soft-time-budget-exceeded", this.index);
    }
  }

  emit(token: HtmlToken): void {
    const maxTokenBytes = this.options.budgets?.maxTokenBytes;
    if (maxTokenBytes !== undefined) {
      const encoded = JSON.stringify(token);
      if (encoded.length > maxTokenBytes) {
        this.addError("max-token-bytes-exceeded", this.index);
        return;
      }
    }

    const previous = this.tokens[this.tokens.length - 1];
    if (previous?.type === "Character" && token.type === "Character") {
      const merged: CharacterToken = {
        type: "Character",
        data: previous.data + token.data
      };
      this.tokens[this.tokens.length - 1] = merged;
      return;
    }

    this.tokens.push(token);
  }

  emitCharacter(data: string): void {
    const maxTextBytes = this.options.budgets?.maxTextBytes;
    this.textBytes += data.length;
    if (maxTextBytes !== undefined && this.textBytes > maxTextBytes) {
      this.addError("max-text-bytes-exceeded", this.index);
      return;
    }

    this.emit({ type: "Character", data });
  }
}

function consumeCharacterReference(input: string, start: number): { readonly value: string; readonly consumed: number } | null {
  if (input[start] !== "&") {
    return null;
  }

  const next = input[start + 1] ?? "";
  if (next === "#") {
    const isHex = (input[start + 2] ?? "").toLowerCase() === "x";
    let index = start + (isHex ? 3 : 2);
    let digits = "";

    const pattern = isHex ? /^[0-9A-Fa-f]$/ : /^[0-9]$/;
    while (index < input.length && pattern.test(input[index] ?? "")) {
      digits += input[index] ?? "";
      index += 1;
    }

    if (digits.length === 0) {
      return null;
    }

    const hasSemicolon = input[index] === ";";
    const raw = Number.parseInt(digits, isHex ? 16 : 10);
    const mapped = WINDOWS_1252_OVERRIDES[raw] ?? raw;
    const safe = Number.isFinite(mapped) && mapped >= 0 && mapped <= 0x10ffff ? mapped : 0xfffd;

    return {
      value: String.fromCodePoint(safe),
      consumed: (index - start) + (hasSemicolon ? 1 : 0)
    };
  }

  let end = start + 1;
  while (end < input.length && /^[A-Za-z0-9]$/.test(input[end] ?? "")) {
    end += 1;
  }

  if (end === start + 1) {
    return null;
  }

  const hasSemicolon = input[end] === ";";

  for (let cursor = end; cursor > start + 1; cursor -= 1) {
    const candidate = input.slice(start + 1, cursor);
    const keyed = `&${candidate}${hasSemicolon && cursor === end ? ";" : ""}`;
    const fallbackKey = `&${candidate};`;

    const matched = getNamedCharacterReference(keyed) ?? getNamedCharacterReference(fallbackKey);
    if (!matched) {
      continue;
    }

    const consumed = (cursor - start) + (hasSemicolon && cursor === end ? 1 : 0);
    return {
      value: matched[0],
      consumed
    };
  }

  return null;
}

function consumeAttributeValue(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "&") {
      const resolved = consumeCharacterReference(source, index);
      if (resolved) {
        out += resolved.value;
        index += resolved.consumed;
        continue;
      }
    }

    out += char;
    index += 1;
  }

  return out;
}

function parseTagAttributes(tagBody: string): {
  readonly attributes: Array<readonly [string, string]>;
  readonly selfClosing: boolean;
} {
  const attributes: Array<readonly [string, string]> = [];
  let index = 0;
  let selfClosing = false;

  while (index < tagBody.length) {
    while (index < tagBody.length && isWhitespace(tagBody[index] ?? "")) {
      index += 1;
    }

    if (index >= tagBody.length) {
      break;
    }

    if (tagBody[index] === "/") {
      selfClosing = true;
      break;
    }

    const nameStart = index;
    while (index < tagBody.length && !isWhitespace(tagBody[index] ?? "") && tagBody[index] !== "=") {
      index += 1;
    }
    const rawName = tagBody.slice(nameStart, index).toLowerCase();
    if (rawName.length === 0) {
      break;
    }

    while (index < tagBody.length && isWhitespace(tagBody[index] ?? "")) {
      index += 1;
    }

    let value = "";
    if (index < tagBody.length && tagBody[index] === "=") {
      index += 1;
      while (index < tagBody.length && isWhitespace(tagBody[index] ?? "")) {
        index += 1;
      }

      const quote = tagBody[index];
      if (quote === "\"" || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < tagBody.length && tagBody[index] !== quote) {
          index += 1;
        }
        value = consumeAttributeValue(tagBody.slice(valueStart, index));
        if (index < tagBody.length && tagBody[index] === quote) {
          index += 1;
        }
      } else {
        const valueStart = index;
        while (index < tagBody.length && !isWhitespace(tagBody[index] ?? "") && tagBody[index] !== "/") {
          index += 1;
        }
        value = consumeAttributeValue(tagBody.slice(valueStart, index));
      }
    }

    attributes.push([rawName, value]);
  }

  return { attributes, selfClosing };
}

function consumeText(runtime: TokenizerRuntime): void {
  const char = runtime.input[runtime.index] ?? "";
  if (char === "&") {
    const resolved = consumeCharacterReference(runtime.input, runtime.index);
    if (resolved) {
      runtime.emitCharacter(resolved.value);
      runtime.index += resolved.consumed;
      return;
    }
  }

  runtime.emitCharacter(char);
  runtime.index += 1;
}

function consumeComment(runtime: TokenizerRuntime): boolean {
  if (!runtime.input.startsWith("<!--", runtime.index)) {
    return false;
  }

  runtime.state = "Comment";
  const end = runtime.input.indexOf("-->", runtime.index + 4);
  if (end === -1) {
    const data = runtime.input.slice(runtime.index + 4);
    runtime.emit({ type: "Comment", data });
    runtime.addError("eof-in-comment", runtime.index);
    runtime.index = runtime.input.length;
    return true;
  }

  const data = runtime.input.slice(runtime.index + 4, end);
  runtime.emit({ type: "Comment", data });
  runtime.index = end + 3;
  runtime.state = "Data";
  return true;
}

function consumeDoctype(runtime: TokenizerRuntime): boolean {
  if (!runtime.input.slice(runtime.index, runtime.index + 9).toUpperCase().startsWith("<!DOCTYPE")) {
    return false;
  }

  runtime.state = "Doctype";
  const end = runtime.input.indexOf(">", runtime.index + 2);
  const close = end === -1 ? runtime.input.length : end;
  const raw = runtime.input.slice(runtime.index + 9, close).trim();
  const [name] = raw.split(/\s+/, 1);
  runtime.emit({
    type: "Doctype",
    name: (name ?? "").toLowerCase(),
    publicId: null,
    systemId: null,
    forceQuirks: end === -1
  });

  if (end === -1) {
    runtime.addError("eof-in-doctype", runtime.index);
    runtime.index = runtime.input.length;
    return true;
  }

  runtime.index = end + 1;
  runtime.state = "Data";
  return true;
}

function consumeEndTag(runtime: TokenizerRuntime): boolean {
  if (!runtime.input.startsWith("</", runtime.index)) {
    return false;
  }

  runtime.state = "EndTag";
  let cursor = runtime.index + 2;
  let name = "";
  while (cursor < runtime.input.length && isTagNameChar(runtime.input[cursor] ?? "")) {
    name += runtime.input[cursor] ?? "";
    cursor += 1;
  }

  const end = runtime.input.indexOf(">", cursor);
  if (name.length === 0) {
    runtime.addError("missing-end-tag-name", runtime.index);
    runtime.index = end === -1 ? runtime.input.length : end + 1;
    runtime.state = "Data";
    return true;
  }

  runtime.emit({
    type: "EndTag",
    name: name.toLowerCase()
  });

  runtime.index = end === -1 ? runtime.input.length : end + 1;
  runtime.state = "Data";
  return true;
}

function consumeStartTag(runtime: TokenizerRuntime): boolean {
  if (runtime.input[runtime.index] !== "<") {
    return false;
  }

  const next = runtime.input[runtime.index + 1] ?? "";
  if (!isAsciiAlpha(next)) {
    return false;
  }

  runtime.state = "StartTag";

  let cursor = runtime.index + 1;
  let name = "";
  while (cursor < runtime.input.length && isTagNameChar(runtime.input[cursor] ?? "")) {
    name += runtime.input[cursor] ?? "";
    cursor += 1;
  }

  const end = runtime.input.indexOf(">", cursor);
  const close = end === -1 ? runtime.input.length : end;
  const tagBody = runtime.input.slice(cursor, close);
  const parsed = parseTagAttributes(tagBody);

  runtime.emit({
    type: "StartTag",
    name: name.toLowerCase(),
    attributes: stableAttributeRecord(parsed.attributes),
    selfClosing: parsed.selfClosing
  });

  runtime.index = end === -1 ? runtime.input.length : end + 1;
  runtime.state = "Data";
  return true;
}

function createDebugSnapshot(runtime: TokenizerRuntime): TokenizerDebugSnapshot | undefined {
  if (!runtime.options.debug?.enabled) {
    return undefined;
  }

  const windowCodePoints = runtime.options.debug.windowCodePoints ?? 32;
  const inputWindowStart = Math.max(0, runtime.index - windowCodePoints);
  const inputWindow = runtime.input.slice(inputWindowStart, runtime.index + windowCodePoints);

  const lastTokensCount = runtime.options.debug.lastTokens ?? 5;
  const lastTokens = runtime.tokens.slice(Math.max(0, runtime.tokens.length - lastTokensCount));

  return {
    currentState: runtime.state,
    inputWindow,
    lastTokens
  };
}

export function tokenize(input: string, options: TokenizeOptions = {}): TokenizeResult {
  const runtime = new TokenizerRuntime(input, options);

  while (runtime.index < runtime.input.length) {
    runtime.enforceTimeBudget();

    runtime.state = "TagOpen";
    if (consumeComment(runtime) || consumeDoctype(runtime) || consumeEndTag(runtime) || consumeStartTag(runtime)) {
      continue;
    }

    runtime.state = "Data";
    consumeText(runtime);
  }

  runtime.emit({ type: "EOF" });

  const debug = runtime.options.debug?.enabled ? createDebugSnapshot(runtime) : undefined;

  return {
    tokens: runtime.tokens,
    errors: runtime.errors,
    ...(debug ? { debug } : {})
  };
}
