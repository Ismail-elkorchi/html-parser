import type { TreeNode, TreeNodeDocument } from "../tree/types.js";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string, quote: "\"" | "'"): string {
  const escapedAmp = value.replace(/&/g, "&amp;");
  if (quote === "\"") {
    return escapedAmp.replace(/"/g, "&quot;");
  }

  return escapedAmp.replace(/'/g, "&#39;");
}

function chooseQuote(value: string): "\"" | "'" | null {
  if (/^[^\s"'=<>`]+$/.test(value)) {
    return null;
  }

  if (!value.includes("\"")) {
    return "\"";
  }

  if (!value.includes("'")) {
    return "'";
  }

  return "\"";
}

function serializeAttributes(attributes: Readonly<Record<string, string>>): string {
  const names = Object.keys(attributes).sort();
  if (names.length === 0) {
    return "";
  }

  const parts = names.map((name) => {
    const value = attributes[name] ?? "";
    const quote = chooseQuote(value);
    if (quote === null) {
      return `${name}=${escapeAttribute(value, "\"")}`;
    }

    return `${name}=${quote}${escapeAttribute(value, quote)}${quote}`;
  });

  return ` ${parts.join(" ")}`;
}

function serializeTreeNode(node: TreeNode): string {
  if (node.kind === "text") {
    return escapeText(node.value);
  }

  if (node.kind === "comment") {
    return `<!--${node.value}-->`;
  }

  if (node.kind === "doctype") {
    return `<!DOCTYPE ${node.name}>`;
  }

  const tagName = node.name;
  const attrs = serializeAttributes(node.attributes);

  if (VOID_ELEMENTS.has(tagName)) {
    return `<${tagName}${attrs}>`;
  }

  const body = node.children.map((child) => serializeTreeNode(child)).join("");
  return `<${tagName}${attrs}>${body}</${tagName}>`;
}

export function serializeTreeDocument(document: TreeNodeDocument): string {
  return document.children.map((child) => serializeTreeNode(child)).join("");
}

function attributesFromFixture(raw: unknown): Readonly<Record<string, string>> {
  if (raw === null || raw === undefined) {
    return Object.freeze({});
  }

  if (Array.isArray(raw)) {
    const record: Record<string, string> = {};
    for (const item of raw) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const candidate = item as Record<string, unknown>;
      const nameValue = candidate["name"];
      const attrValue = candidate["value"];
      const name = typeof nameValue === "string" ? nameValue : "";
      const value = typeof attrValue === "string" ? attrValue : "";
      if (name.length > 0) {
        record[name] = value;
      }
    }
    return Object.freeze(record);
  }

  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(record)) {
      out[name] = typeof value === "string" ? value : "";
    }
    return Object.freeze(out);
  }

  return Object.freeze({});
}

interface FixtureSerializeOptions {
  readonly quote_char?: "'" | "\"";
  readonly quote_attr_values?: boolean;
  readonly minimize_boolean_attributes?: boolean;
  readonly use_trailing_solidus?: boolean;
  readonly escape_lt_in_attrs?: boolean;
  readonly escape_rcdata?: boolean;
  readonly strip_whitespace?: boolean;
  readonly inject_meta_charset?: boolean;
  readonly encoding?: string;
}

interface FixtureAttribute {
  readonly namespace: string | null;
  readonly name: string;
  readonly value: string;
}

interface FixtureStartTagToken {
  readonly type: "StartTag";
  readonly namespace: string | null;
  readonly name: string;
  readonly attributes: readonly FixtureAttribute[];
}

interface FixtureEmptyTagToken {
  readonly type: "EmptyTag";
  readonly namespace: string | null;
  readonly name: string;
  readonly attributes: readonly FixtureAttribute[];
}

interface FixtureEndTagToken {
  readonly type: "EndTag";
  readonly namespace: string | null;
  readonly name: string;
}

interface FixtureCharactersToken {
  readonly type: "Characters";
  readonly data: string;
}

interface FixtureCommentToken {
  readonly type: "Comment";
  readonly data: string;
}

interface FixtureDoctypeToken {
  readonly type: "Doctype";
  readonly name: string;
  readonly publicId: string;
  readonly systemId: string;
}

type FixtureToken =
  | FixtureStartTagToken
  | FixtureEmptyTagToken
  | FixtureEndTagToken
  | FixtureCharactersToken
  | FixtureCommentToken
  | FixtureDoctypeToken;

const SPACE_CHAR_RE = /^[\t\n\f\r ]/;
const SPACE_RUN_RE = /[\t\n\f\r ]+/g;
const RAWTEXT_PARENTS = new Set(["script", "style"]);
const PRESERVE_WHITESPACE_PARENTS = new Set(["pre", "textarea", "script", "style"]);
const BOOLEAN_ATTRIBUTES = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected"
]);

const OMITTABLE_START_TAGS = new Set(["html", "head", "body", "colgroup", "tbody"]);
const P_END_TAG_FORBIDDEN_FOLLOWING_END = new Set(["a", "audio", "del", "ins", "map", "noscript", "video"]);
const P_END_TAG_FOLLOWING_START = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "datagrid",
  "dialog",
  "dir",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "search",
  "section",
  "table",
  "ul"
]);

function toFixtureAttributes(raw: unknown): readonly FixtureAttribute[] {
  if (Array.isArray(raw)) {
    const attrs: FixtureAttribute[] = [];
    for (const item of raw) {
      if (item === null || typeof item !== "object") {
        continue;
      }

      const attr = item as Record<string, unknown>;
      const name = typeof attr["name"] === "string" ? attr["name"] : "";
      const value = typeof attr["value"] === "string" ? attr["value"] : "";
      const namespace = typeof attr["namespace"] === "string" ? attr["namespace"] : null;
      if (name.length === 0) {
        continue;
      }

      attrs.push({ namespace, name, value });
    }
    return attrs;
  }

  const attrs: FixtureAttribute[] = [];
  const record = attributesFromFixture(raw);
  for (const [name, value] of Object.entries(record)) {
    attrs.push({ namespace: null, name, value });
  }
  return attrs;
}

function parseFixtureToken(entry: unknown): FixtureToken | null {
  if (!Array.isArray(entry) || entry.length === 0 || typeof entry[0] !== "string") {
    return null;
  }

  const type = entry[0];
  if (type === "StartTag") {
    if (
      typeof entry[1] === "string" &&
      typeof entry[2] === "string" &&
      (entry[1].includes("://") || entry[1].startsWith("http:") || entry[1].startsWith("https:"))
    ) {
      return {
        type: "StartTag",
        namespace: entry[1],
        name: entry[2],
        attributes: toFixtureAttributes(entry[3])
      };
    }

    return {
      type: "StartTag",
      namespace: null,
      name: typeof entry[1] === "string" ? entry[1] : "",
      attributes: toFixtureAttributes(entry[2])
    };
  }

  if (type === "EmptyTag") {
    return {
      type: "EmptyTag",
      namespace: null,
      name: typeof entry[1] === "string" ? entry[1] : "",
      attributes: toFixtureAttributes(entry[2])
    };
  }

  if (type === "EndTag") {
    if (typeof entry[2] === "string") {
      return {
        type: "EndTag",
        namespace: typeof entry[1] === "string" ? entry[1] : null,
        name: entry[2]
      };
    }

    return {
      type: "EndTag",
      namespace: null,
      name: typeof entry[1] === "string" ? entry[1] : ""
    };
  }

  if (type === "Characters") {
    return {
      type: "Characters",
      data: typeof entry[1] === "string" ? entry[1] : ""
    };
  }

  if (type === "Comment") {
    return {
      type: "Comment",
      data: typeof entry[1] === "string" ? entry[1] : ""
    };
  }

  if (type === "Doctype") {
    return {
      type: "Doctype",
      name: typeof entry[1] === "string" ? entry[1] : "html",
      publicId: typeof entry[2] === "string" ? entry[2] : "",
      systemId: typeof entry[3] === "string" ? entry[3] : ""
    };
  }

  return null;
}

function normalizeFixtureOptions(options: FixtureSerializeOptions | undefined): Required<FixtureSerializeOptions> {
  return {
    quote_char: options?.quote_char === "'" ? "'" : "\"",
    quote_attr_values: options?.quote_attr_values === true,
    minimize_boolean_attributes: options?.minimize_boolean_attributes !== false,
    use_trailing_solidus: options?.use_trailing_solidus === true,
    escape_lt_in_attrs: options?.escape_lt_in_attrs === true,
    escape_rcdata: options?.escape_rcdata === true,
    strip_whitespace: options?.strip_whitespace === true,
    inject_meta_charset: options?.inject_meta_charset === true,
    encoding: options?.encoding ?? ""
  };
}

function startsWithSpaceCharacter(text: string): boolean {
  return SPACE_CHAR_RE.test(text);
}

function nextTagName(token: FixtureToken | null): string | null {
  if (token === null) {
    return null;
  }
  if (token.type === "StartTag" || token.type === "EmptyTag" || token.type === "EndTag") {
    return token.name;
  }
  return null;
}

function shouldOmitStartTag(
  token: FixtureStartTagToken,
  next: FixtureToken | null,
  previous: FixtureToken | null
): boolean {
  const tagName = token.name;
  const attributeCount = token.attributes.length;

  if (!OMITTABLE_START_TAGS.has(tagName) || attributeCount > 0) {
    return false;
  }

  if (tagName === "html" || tagName === "body") {
    if (next === null) {
      return true;
    }
    if (next.type === "Comment") {
      return false;
    }
    if (next.type === "Characters" && startsWithSpaceCharacter(next.data)) {
      return false;
    }
    return true;
  }

  if (tagName === "head") {
    if (next === null) {
      return false;
    }
    if (next.type === "Comment" || next.type === "Characters") {
      return false;
    }
    if (next.type === "EndTag" && next.name !== "head") {
      return false;
    }
    return true;
  }

  if (tagName === "colgroup") {
    const nextName = nextTagName(next);
    return nextName === "col";
  }

  if (tagName === "tbody") {
    const nextName = nextTagName(next);
    if (nextName !== "tr") {
      return false;
    }

    if (
      previous !== null &&
      previous.type === "EndTag" &&
      (previous.name === "tbody" || previous.name === "thead" || previous.name === "tfoot")
    ) {
      return false;
    }

    return true;
  }

  return false;
}

function shouldOmitEndTag(token: FixtureEndTagToken, next: FixtureToken | null): boolean {
  const tagName = token.name;

  if (tagName === "html" || tagName === "head" || tagName === "body") {
    if (next === null) {
      return true;
    }
    if (next.type === "Comment") {
      return false;
    }
    if (next.type === "Characters" && startsWithSpaceCharacter(next.data)) {
      return false;
    }
    return true;
  }

  const nextName = nextTagName(next);
  if (tagName === "li") {
    return (
      nextName === "li" ||
      nextName === "ul" ||
      nextName === "ol" ||
      nextName === "menu" ||
      next?.type === "EndTag" ||
      next === null
    );
  }

  if (tagName === "dt") {
    return nextName === "dt" || nextName === "dd" || nextName === "dl";
  }

  if (tagName === "dd") {
    return nextName === "dt" || nextName === "dd" || nextName === "dl" || next?.type === "EndTag";
  }

  if (tagName === "p") {
    if (next === null) {
      return true;
    }
    if (next.type === "StartTag" || next.type === "EmptyTag") {
      return P_END_TAG_FOLLOWING_START.has(next.name);
    }
    if (next.type === "EndTag") {
      return !P_END_TAG_FORBIDDEN_FOLLOWING_END.has(next.name);
    }
    return false;
  }

  if (tagName === "rt" || tagName === "rp") {
    return nextName === "rt" || nextName === "rp" || nextName === "ruby" || next === null;
  }

  if (tagName === "option") {
    return (
      nextName === "option" ||
      nextName === "optgroup" ||
      nextName === "select" ||
      nextName === "datalist" ||
      next?.type === "EndTag" ||
      next === null
    );
  }

  if (tagName === "optgroup") {
    return nextName === "optgroup" || nextName === "select" || next?.type === "EndTag" || next === null;
  }

  if (tagName === "colgroup") {
    if (next === null) {
      return true;
    }
    if (next.type === "Comment") {
      return false;
    }
    if (next.type === "Characters" && startsWithSpaceCharacter(next.data)) {
      return false;
    }
    if (nextName === "col") {
      return false;
    }
    if (nextName === "colgroup") {
      return false;
    }
    return true;
  }

  if (tagName === "thead") {
    return nextName === "tbody" || nextName === "tfoot" || nextName === "table";
  }

  if (tagName === "tbody") {
    return nextName === "tbody" || nextName === "tfoot" || nextName === "table" || next?.type === "EndTag" || next === null;
  }

  if (tagName === "tfoot") {
    return nextName === "tbody" || nextName === "table" || next?.type === "EndTag" || next === null;
  }

  if (tagName === "tr") {
    return (
      nextName === "tr" ||
      nextName === "tbody" ||
      nextName === "thead" ||
      nextName === "tfoot" ||
      nextName === "table" ||
      next?.type === "EndTag" ||
      next === null
    );
  }

  if (tagName === "td" || tagName === "th") {
    return (
      nextName === "td" ||
      nextName === "th" ||
      nextName === "tr" ||
      nextName === "tbody" ||
      nextName === "thead" ||
      nextName === "tfoot" ||
      nextName === "table" ||
      next?.type === "EndTag" ||
      next === null
    );
  }

  return false;
}

function escapeAttributeForFixture(
  value: string,
  quoteChar: "'" | "\"",
  escapeLt: boolean
): string {
  let escaped = value.replace(/&/g, "&amp;");
  if (escapeLt) {
    escaped = escaped.replace(/</g, "&lt;");
  }
  if (quoteChar === "\"") {
    escaped = escaped.replace(/"/g, "&quot;");
  } else {
    escaped = escaped.replace(/'/g, "&#39;");
  }
  return escaped;
}

function shouldQuoteAttributeValue(value: string): boolean {
  if (value.length === 0) {
    return true;
  }
  return /[\t\n\f\r "'=>]/.test(value);
}

function serializeFixtureAttributes(
  attributes: readonly FixtureAttribute[],
  options: Required<FixtureSerializeOptions>
): string {
  if (attributes.length === 0) {
    return "";
  }

  const ordered = [...attributes].sort((left, right) => left.name.localeCompare(right.name));
  const parts: string[] = [];
  for (const attr of ordered) {
    const attrName = attr.name;
    const attrValue = attr.value;
    const isBoolean =
      attr.namespace === null &&
      (BOOLEAN_ATTRIBUTES.has(attrName.toLowerCase()) || attrValue.toLowerCase() === attrName.toLowerCase()) &&
      attrValue.toLowerCase() === attrName.toLowerCase();

    if (isBoolean && options.minimize_boolean_attributes) {
      parts.push(attrName);
      continue;
    }

    let quoteChar = options.quote_char;
    const forceQuote =
      options.quote_attr_values || shouldQuoteAttributeValue(attrValue) || (options.escape_lt_in_attrs && attrValue.includes("<"));
    if (!forceQuote) {
      const escapedValue = escapeAttributeForFixture(attrValue, options.quote_char, options.escape_lt_in_attrs);
      parts.push(`${attrName}=${escapedValue}`);
      continue;
    }

    if (!options.quote_attr_values && options.quote_char === "\"") {
      if (attrValue.includes("\"") && !attrValue.includes("'")) {
        quoteChar = "'";
      } else if (attrValue.includes("'") && !attrValue.includes("\"")) {
        quoteChar = "\"";
      }
    }

    const escapedValue = escapeAttributeForFixture(attrValue, quoteChar, options.escape_lt_in_attrs);
    parts.push(`${attrName}=${quoteChar}${escapedValue}${quoteChar}`);
  }

  return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

function updateMetaEncoding(
  token: FixtureStartTagToken | FixtureEmptyTagToken,
  encoding: string
): { updated: FixtureStartTagToken | FixtureEmptyTagToken; touched: boolean } {
  if (token.name !== "meta") {
    return { updated: token, touched: false };
  }

  const attrs = token.attributes.map((attr) => ({ ...attr }));
  let touched = false;

  for (const attr of attrs) {
    if (attr.name.toLowerCase() === "charset") {
      attr.value = encoding;
      touched = true;
    }
  }

  const httpEquiv = attrs.find((attr) => attr.name.toLowerCase() === "http-equiv")?.value.toLowerCase();
  if (httpEquiv === "content-type") {
    const contentAttr = attrs.find((attr) => attr.name.toLowerCase() === "content");
    if (contentAttr !== undefined) {
      const updated = contentAttr.value.replace(
        /charset\s*=\s*("[^"]*"|'[^']*'|[^\s;]+)/i,
        `charset=${encoding}`
      );
      if (updated !== contentAttr.value) {
        contentAttr.value = updated;
        touched = true;
      }
    }
  }

  return {
    updated: {
      ...token,
      attributes: attrs
    },
    touched
  };
}

function applyInjectMetaCharset(
  tokens: readonly FixtureToken[],
  options: Required<FixtureSerializeOptions>
): FixtureToken[] {
  if (!options.inject_meta_charset || options.encoding.length === 0) {
    return [...tokens];
  }

  const out = [...tokens];
  for (let i = 0; i < out.length; i += 1) {
    const token = out[i];
    if (token === undefined || token.type !== "StartTag" || token.name !== "head") {
      continue;
    }

    let depth = 1;
    let endIndex = i + 1;
    while (endIndex < out.length && depth > 0) {
      const current = out[endIndex];
      if (current?.type === "StartTag" && current.name === "head") {
        depth += 1;
      } else if (current?.type === "EndTag" && current.name === "head") {
        depth -= 1;
      }
      endIndex += 1;
    }

    const headEnd = Math.max(i + 1, endIndex - 1);
    let hasCharsetMeta = false;

    for (let cursor = i + 1; cursor < headEnd; cursor += 1) {
      const current = out[cursor];
      if (current === undefined || (current.type !== "StartTag" && current.type !== "EmptyTag")) {
        continue;
      }

      const { updated, touched } = updateMetaEncoding(current, options.encoding);
      out[cursor] = updated;
      if (touched) {
        hasCharsetMeta = true;
      }
    }

    if (!hasCharsetMeta) {
      out.splice(i + 1, 0, {
        type: "EmptyTag",
        namespace: "http://www.w3.org/1999/xhtml",
        name: "meta",
        attributes: [{ namespace: null, name: "charset", value: options.encoding }]
      });
      i += 1;
    }
  }

  return out;
}

function popMatching(stack: string[], name: string): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index] === name) {
      stack.splice(index);
      return;
    }
  }
}

function serializeCharacterToken(
  data: string,
  openStack: readonly string[],
  options: Required<FixtureSerializeOptions>
): string {
  const parentTagName = openStack.length > 0 ? (openStack[openStack.length - 1] ?? null) : null;
  const preserveWhitespace = openStack.some((tagName) => PRESERVE_WHITESPACE_PARENTS.has(tagName));

  let text = data;
  if (options.strip_whitespace && !preserveWhitespace) {
    text = text.replace(SPACE_RUN_RE, " ");
  }

  if (parentTagName !== null && RAWTEXT_PARENTS.has(parentTagName) && !options.escape_rcdata) {
    return text;
  }

  if (options.escape_rcdata && parentTagName !== null && (RAWTEXT_PARENTS.has(parentTagName) || parentTagName === "textarea" || parentTagName === "title")) {
    return escapeText(text);
  }

  return escapeText(text);
}

function serializeDoctypeToken(token: FixtureDoctypeToken): string {
  const hasPublic = token.publicId.length > 0;
  const hasSystem = token.systemId.length > 0;

  if (hasPublic && hasSystem) {
    return `<!DOCTYPE ${token.name} PUBLIC "${token.publicId}" "${token.systemId}">`;
  }

  if (hasPublic && !hasSystem) {
    return `<!DOCTYPE ${token.name} PUBLIC "${token.publicId}">`;
  }

  if (!hasPublic && hasSystem) {
    return `<!DOCTYPE ${token.name} SYSTEM "${token.systemId}">`;
  }

  return `<!DOCTYPE ${token.name}>`;
}

export function serializeFixtureTokenStream(
  tokens: readonly unknown[],
  options: FixtureSerializeOptions = {}
): string {
  const normalizedOptions = normalizeFixtureOptions(options);
  const parsed = tokens.map((entry) => parseFixtureToken(entry)).filter((entry) => entry !== null);
  const prepared = applyInjectMetaCharset(parsed, normalizedOptions);
  const chunks: string[] = [];
  const openStack: string[] = [];

  for (let index = 0; index < prepared.length; index += 1) {
    const token = prepared[index];
    const next = prepared[index + 1] ?? null;
    const previous = index > 0 ? (prepared[index - 1] ?? null) : null;
    if (token === undefined) {
      continue;
    }

    if (token.type === "StartTag") {
      const omit = shouldOmitStartTag(token, next, previous);
      if (!omit) {
        const attrs = serializeFixtureAttributes(token.attributes, normalizedOptions);
        chunks.push(`<${token.name}${attrs}>`);
      }
      openStack.push(token.name);
      continue;
    }

    if (token.type === "EmptyTag") {
      const attrs = serializeFixtureAttributes(token.attributes, normalizedOptions);
      if (normalizedOptions.use_trailing_solidus && VOID_ELEMENTS.has(token.name)) {
        chunks.push(`<${token.name}${attrs} />`);
      } else {
        chunks.push(`<${token.name}${attrs}>`);
      }
      continue;
    }

    if (token.type === "EndTag") {
      const omit = shouldOmitEndTag(token, next);
      if (!omit) {
        chunks.push(`</${token.name}>`);
      }
      popMatching(openStack, token.name);
      continue;
    }

    if (token.type === "Characters") {
      chunks.push(serializeCharacterToken(token.data, openStack, normalizedOptions));
      continue;
    }

    if (token.type === "Comment") {
      chunks.push(`<!--${token.data}-->`);
      continue;
    }

    chunks.push(serializeDoctypeToken(token));
  }

  return chunks.join("");
}
