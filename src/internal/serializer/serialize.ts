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

export function serializeFixtureTokenStream(tokens: readonly unknown[]): string {
  const chunks: string[] = [];

  for (const entry of tokens) {
    if (!Array.isArray(entry) || entry.length === 0) {
      continue;
    }

    const type = typeof entry[0] === "string" ? entry[0] : "";
    if (type === "StartTag") {
      const name = typeof entry[2] === "string" ? entry[2] : "";
      const attrs = serializeAttributes(attributesFromFixture(entry[3]));
      chunks.push(`<${name}${attrs}>`);
      continue;
    }

    if (type === "EmptyTag") {
      const name = typeof entry[1] === "string" ? entry[1] : "";
      const attrs = serializeAttributes(attributesFromFixture(entry[2]));
      chunks.push(`<${name}${attrs}>`);
      continue;
    }

    if (type === "EndTag") {
      const name = typeof entry[1] === "string" ? entry[1] : "";
      chunks.push(`</${name}>`);
      continue;
    }

    if (type === "Characters") {
      const text = typeof entry[1] === "string" ? entry[1] : "";
      chunks.push(escapeText(text));
      continue;
    }

    if (type === "Comment") {
      const value = typeof entry[1] === "string" ? entry[1] : "";
      chunks.push(`<!--${value}-->`);
      continue;
    }

    if (type === "Doctype") {
      const name = typeof entry[1] === "string" ? entry[1] : "html";
      const publicId = typeof entry[2] === "string" ? entry[2] : null;
      const systemId = typeof entry[3] === "string" ? entry[3] : null;

      if (publicId !== null && systemId !== null) {
        chunks.push(`<!DOCTYPE ${name} PUBLIC "${publicId}" "${systemId}">`);
      } else if (publicId !== null) {
        chunks.push(`<!DOCTYPE ${name} PUBLIC "${publicId}">`);
      } else if (systemId !== null) {
        chunks.push(`<!DOCTYPE ${name} SYSTEM "${systemId}">`);
      } else {
        chunks.push(`<!DOCTYPE ${name}>`);
      }
    }
  }

  return chunks.join("");
}
