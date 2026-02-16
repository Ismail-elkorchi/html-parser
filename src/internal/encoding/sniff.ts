export interface EncodingSniffOptions {
  readonly transportEncodingLabel?: string;
  readonly maxPrescanBytes?: number;
  readonly defaultEncoding?: string;
}

export interface EncodingSniffResult {
  readonly encoding: string;
  readonly source: "bom" | "transport" | "meta" | "default";
}

const WINDOWS_1252_ALIASES = new Set([
  "iso-8859-1",
  "iso8859-1",
  "latin1",
  "latin-1",
  "us-ascii"
]);

function detectBom(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8";
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return "utf-16be";
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return "utf-16le";
  }

  return null;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function canonicalizeLabel(label: string, source: "bom" | "transport" | "meta" | "default"): string | null {
  const normalized = stripQuotes(label).toLowerCase().trim();
  if (normalized.length === 0) {
    return null;
  }

  if (WINDOWS_1252_ALIASES.has(normalized)) {
    return "windows-1252";
  }

  if ((source === "meta" || source === "transport") && normalized.startsWith("utf-16")) {
    return "utf-8";
  }

  try {
    const encoding = new TextDecoder(normalized).encoding.toLowerCase();

    if (encoding === "iso-8859-1") {
      return "windows-1252";
    }

    if ((source === "meta" || source === "transport") && encoding.startsWith("utf-16")) {
      return "utf-8";
    }

    return encoding;
  } catch {
    return null;
  }
}

function decodeLatin1(bytes: Uint8Array): string {
  let decodedText = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index];
    if (value === undefined) {
      continue;
    }
    decodedText += String.fromCharCode(value);
  }
  return decodedText;
}

function parseMetaAttributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const body = tag.replace(/^<meta/i, "").replace(/>$/, "");

  let index = 0;
  while (index < body.length) {
    while (index < body.length && /[\t\n\f\r /]/.test(body[index] ?? "")) {
      index += 1;
    }
    if (index >= body.length) {
      break;
    }

    const nameStart = index;
    while (index < body.length && !/[\t\n\f\r />=]/.test(body[index] ?? "")) {
      index += 1;
    }
    const rawName = body.slice(nameStart, index).toLowerCase();
    if (rawName.length === 0) {
      break;
    }

    while (index < body.length && /[\t\n\f\r ]/.test(body[index] ?? "")) {
      index += 1;
    }

    let value = "";
    if (index < body.length && body[index] === "=") {
      index += 1;
      while (index < body.length && /[\t\n\f\r ]/.test(body[index] ?? "")) {
        index += 1;
      }

      const quote = body[index];
      if (quote === "\"" || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < body.length && body[index] !== quote) {
          index += 1;
        }
        if (index >= body.length) {
          return new Map();
        }
        value = body.slice(valueStart, index);
        if (index < body.length && body[index] === quote) {
          index += 1;
        }
      } else {
        const valueStart = index;
        while (index < body.length && !/[\t\n\f\r >]/.test(body[index] ?? "")) {
          index += 1;
        }
        value = body.slice(valueStart, index);
      }
    }

    attrs.set(rawName, value);
  }

  return attrs;
}

function extractMetaTags(scan: string): string[] {
  const tags: string[] = [];
  let index = 0;

  while (index < scan.length) {
    const tagStartIndex = scan.indexOf("<", index);
    if (tagStartIndex === -1 || tagStartIndex + 2 > scan.length) {
      break;
    }

    let cursor = tagStartIndex + 1;
    let quote: "\"" | "'" | null = null;
    let closed = false;

    while (cursor < scan.length) {
      const currentChar = scan[cursor];
      if (quote === null && (currentChar === "\"" || currentChar === "'")) {
        quote = currentChar;
        cursor += 1;
        continue;
      }

      if (quote !== null && currentChar === quote) {
        quote = null;
        cursor += 1;
        continue;
      }

      if (quote === null && currentChar === ">") {
        const tagText = scan.slice(tagStartIndex, cursor + 1);
        if (/^<meta(?=[\t\n\f\r />])/i.test(tagText)) {
          tags.push(tagText);
        }
        index = cursor + 1;
        closed = true;
        break;
      }

      cursor += 1;
    }

    if (!closed) {
      break;
    }
  }

  return tags;
}

function extractCharsetFromContent(content: string): string | null {
  const match = content.match(/charset\s*=\s*("[^"]*"|'[^']*'|[^\s;"'>]+)/i);
  if (!match) {
    return null;
  }

  const captured = match[1];
  if (!captured) {
    return null;
  }

  return stripQuotes(captured);
}

function stripHtmlComments(input: string): string {
  let cursor = 0;
  let output = "";

  while (cursor < input.length) {
    const commentStart = input.indexOf("<!--", cursor);
    if (commentStart === -1) {
      output += input.slice(cursor);
      break;
    }

    output += input.slice(cursor, commentStart);

    const commentEnd = input.indexOf("-->", commentStart + 4);
    if (commentEnd === -1) {
      break;
    }

    cursor = commentEnd + 3;
  }

  return output;
}

function sniffMetaCharset(bytes: Uint8Array, maxPrescanBytes: number): string | null {
  const scanSize = Math.min(bytes.length, maxPrescanBytes);
  const scan = stripHtmlComments(decodeLatin1(bytes.subarray(0, scanSize)));

  for (const tag of extractMetaTags(scan)) {
    const attrs = parseMetaAttributes(tag);

    const direct = attrs.get("charset");
    if (direct) {
      const canonical = canonicalizeLabel(direct, "meta");
      if (canonical) {
        return canonical;
      }
    }

    const httpEquiv = attrs.get("http-equiv")?.toLowerCase();
    const content = attrs.get("content");
    if (httpEquiv === "content-type" && content) {
      const extracted = extractCharsetFromContent(content);
      if (extracted) {
        const canonical = canonicalizeLabel(extracted, "meta");
        if (canonical) {
          return canonical;
        }
      }
    }
  }

  return null;
}

export function sniffHtmlEncoding(bytes: Uint8Array, options: EncodingSniffOptions = {}): EncodingSniffResult {
  const defaultEncoding = canonicalizeLabel(options.defaultEncoding ?? "windows-1252", "default") ?? "windows-1252";

  const bom = detectBom(bytes);
  if (bom) {
    return { encoding: bom, source: "bom" };
  }

  if (options.transportEncodingLabel) {
    const transport = canonicalizeLabel(options.transportEncodingLabel, "transport");
    if (transport) {
      return { encoding: transport, source: "transport" };
    }
  }

  const prescan = sniffMetaCharset(bytes, options.maxPrescanBytes ?? 16384);
  if (prescan) {
    return { encoding: prescan, source: "meta" };
  }

  return { encoding: defaultEncoding, source: "default" };
}

export function decodeHtmlBytes(bytes: Uint8Array, options: EncodingSniffOptions = {}): { text: string; sniff: EncodingSniffResult } {
  const sniff = sniffHtmlEncoding(bytes, options);
  const decoder = new TextDecoder(sniff.encoding);
  return {
    text: decoder.decode(bytes),
    sniff
  };
}
