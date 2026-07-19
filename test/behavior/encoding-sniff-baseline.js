import test from "node:test";
import assert from "node:assert/strict";

import { sniffHtmlEncoding } from "../../dist/internal/encoding/mod.js";

function bytesFromText(text) {
  return new TextEncoder().encode(text);
}

test("baseline: sniffHtmlEncoding maps latin1 aliases to windows-1252 for meta charset", () => {
  const bytes = bytesFromText("<meta charset=\"latin1\"><p>x</p>");
  const result = sniffHtmlEncoding(bytes);
  assert.equal(result.encoding, "windows-1252");
  assert.equal(result.source, "meta");
});

test("baseline: sniffHtmlEncoding normalizes utf-16 meta labels to utf-8", () => {
  const bytes = bytesFromText("<meta charset=\"utf-16le\"><p>x</p>");
  const result = sniffHtmlEncoding(bytes);
  assert.equal(result.encoding, "utf-8");
  assert.equal(result.source, "meta");
});

test("baseline: sniffHtmlEncoding prioritizes BOM over transport and meta signals", () => {
  const content = bytesFromText("<meta charset=\"windows-1252\"><p>x</p>");
  const bytes = new Uint8Array(3 + content.length);
  bytes.set([0xef, 0xbb, 0xbf], 0);
  bytes.set(content, 3);

  const result = sniffHtmlEncoding(bytes, { transportEncodingLabel: "iso-8859-1" });
  assert.equal(result.encoding, "utf-8");
  assert.equal(result.source, "bom");
});
