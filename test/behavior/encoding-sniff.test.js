import test from "node:test";
import assert from "node:assert/strict";

import { parseBytes, parseStream, serialize } from "../../dist/mod.js";

import { sniffHtmlEncoding } from "../../dist/internal/encoding/sniff.js";

function bytesFromText(text) {
  return new TextEncoder().encode(text);
}

test("sniffHtmlEncoding maps latin1 aliases to windows-1252 for meta charset", () => {
  const bytes = bytesFromText("<meta charset=\"latin1\"><p>x</p>");
  const result = sniffHtmlEncoding(bytes);
  assert.equal(result.encoding, "windows-1252");
  assert.equal(result.source, "meta");
});

test("sniffHtmlEncoding normalizes unicode meta labels to utf-8", () => {
  const bytes = bytesFromText("<meta charset=\"unicode\"><p>x</p>");
  const result = sniffHtmlEncoding(bytes);
  assert.equal(result.encoding, "utf-8");
  assert.equal(result.source, "meta");
});

test("sniffHtmlEncoding treats unterminated comments as blocking charset prescan", () => {
  const bytes = bytesFromText("<!-- comment <meta charset=\"windows-1252\"><meta charset=\"utf-8\">");
  const result = sniffHtmlEncoding(bytes);
  assert.equal(result.encoding, "windows-1252");
  assert.equal(result.source, "default");
});

test("sniffHtmlEncoding prioritizes BOM over transport and meta signals", () => {
  const content = bytesFromText("<meta charset=\"windows-1252\"><p>x</p>");
  const bytes = new Uint8Array(3 + content.length);
  bytes.set([0xef, 0xbb, 0xbf], 0);
  bytes.set(content, 3);

  const result = sniffHtmlEncoding(bytes, { transportEncodingLabel: "iso-8859-1" });
  assert.equal(result.encoding, "utf-8");
  assert.equal(result.source, "bom");
});

function chunkStream(bytes, width = 1) {
  return new globalThis.ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += width) {
        controller.enqueue(bytes.subarray(offset, offset + width));
      }
      controller.close();
    }
  });
}

function utf16(text, endian, bom = false) {
  const bytes = new Uint8Array(text.length * 2 + (bom ? 2 : 0));
  const view = new DataView(bytes.buffer);
  if (bom) view.setUint16(0, 0xfeff, endian === "le");
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16((bom ? 2 : 0) + index * 2, text.charCodeAt(index), endian === "le");
  }
  return bytes;
}

async function assertPublicDecode(bytes, transport, expected, name, source) {
  const options = { sourceRetention: "text", transportEncodingLabel: transport };
  const direct = parseBytes(bytes, options);
  assert.equal(direct.sourceText, expected);
  assert.deepEqual(direct.metadata.encoding, { name, source });
  for (const width of [1, 2, 3, 7, bytes.length]) {
    const streamed = await parseStream(chunkStream(bytes, width), options);
    assert.equal(streamed.sourceText, direct.sourceText);
    assert.deepEqual(streamed.metadata.encoding, direct.metadata.encoding);
    assert.equal(serialize(streamed.tree), serialize(direct.tree));
    assert.deepEqual(streamed.formAssociations, direct.formAssociations);
  }
}

test("public bytes and streams preserve transport UTF-16 across split units and surrogate pairs", async () => {
  const html = "<!doctype html><meta charset=windows-1252><title>Café😀</title><form><input></form>";
  for (const endian of ["le", "be"]) {
    await assertPublicDecode(utf16(html, endian), `utf-16${endian}`, html, `utf-16${endian}`, "transport");
  }
  await assertPublicDecode(utf16(html, "le"), "unicode", html, "utf-16le", "transport");
});

test("public BOM selection wins conflicting transport and meta declarations in every chunking", async () => {
  const html = "<!doctype html><meta charset=windows-1252><p>Café😀</p>";
  for (const endian of ["le", "be"]) {
    await assertPublicDecode(utf16(html, endian, true), "utf-8", html, `utf-16${endian}`, "bom");
  }
  const encoded = bytesFromText(html);
  const bytes = new Uint8Array(encoded.length + 3);
  bytes.set([0xef, 0xbb, 0xbf]);
  bytes.set(encoded, 3);
  await assertPublicDecode(bytes, "utf-16be", html, "utf-8", "bom");
});

test("encoding labels are validated before meta-only UTF-16 coercion", async () => {
  for (const label of ["utf-16", "UTF-16LE", "utf-16be", "unicode", "unicodefffe"]) {
    const html = `<meta charset="${label}"><p>Café</p>`;
    await assertPublicDecode(bytesFromText(html), "unsupported", html, "utf-8", "meta");
  }
  for (const label of ["utf-16-invalid", "utf-16x", "latin-1", "'utf-8'", "\u00a0utf-8\u00a0"]) {
    const html = `<meta charset="${label}"><meta charset=utf-8><p>Café</p>`;
    await assertPublicDecode(bytesFromText(html), label, html, "utf-8", "meta");
    assert.deepEqual(sniffHtmlEncoding(bytesFromText(`<meta charset="${label}">`)), {
      encoding: "windows-1252", source: "default"
    });
  }
  const html = "<meta charset=windows-1252><p>Café</p>";
  await assertPublicDecode(bytesFromText(html), " \tUTF-8\r\n", html, "utf-8", "transport");
});

test("duplicate charset, content and http-equiv meta attributes are case-insensitive first-wins", async () => {
  const cases = [
    ["charset=utf-8 CHARSET=windows-1252", "utf-8", "meta"],
    ["charset=windows-1252 charset=utf-8", "windows-1252", "meta"],
    ["charset=bad charset=utf-8", "windows-1252", "default"],
    ["charset='' charset=utf-8", "windows-1252", "default"],
    ["http-equiv=content-type content='text/html;charset=utf-8' CONTENT='text/html;charset=windows-1252'", "utf-8", "meta"],
    ["content='text/html;charset=windows-1252' content='text/html;charset=utf-8' http-equiv=content-type", "windows-1252", "meta"],
    ["http-equiv=content-type HTTP-EQUIV=refresh content='text/html;charset=utf-8'", "utf-8", "meta"],
    ["http-equiv=refresh http-equiv=content-type content='text/html;charset=utf-8'", "windows-1252", "default"]
  ];
  for (const [attrs, name, source] of cases) {
    const html = `<meta ${attrs}><p>Café</p>`;
    const bytes = bytesFromText(html);
    const expected = new globalThis.TextDecoder(name).decode(bytes);
    await assertPublicDecode(bytes, "unsupported", expected, name, source);
  }
});

test("meta content labels preserve non-ASCII whitespace and obey attribute processing order", async () => {
  const declarations = [
    ["http-equiv=content-type content=\"text/html; charset='\u00a0utf-8\u00a0'\"", "windows-1252", "default"],
    ["http-equiv=content-type content=\"text/html; charset=\u00a0utf-8\u00a0\"", "windows-1252", "default"],
    ["http-equiv=content-type content='text/html;charset=utf-8' charset=invalid", "windows-1252", "default"],
    ["charset=invalid http-equiv=content-type content='text/html;charset=utf-8'", "utf-8", "meta"],
    ["content='text/html;charset=utf-8' charset=windows-1252 http-equiv=content-type", "windows-1252", "meta"],
    ["content='text/html;charset=utf-8' content='' http-equiv=content-type", "utf-8", "meta"],
    ["content='' content='text/html;charset=utf-8' http-equiv=content-type", "windows-1252", "default"]
  ];
  for (const [attributes, encoding, source] of declarations) {
    const bytes = bytesFromText(`<meta ${attributes}>`);
    assert.deepEqual(sniffHtmlEncoding(bytes), { encoding, source });
    await assertPublicDecode(bytes, "unsupported", new globalThis.TextDecoder(encoding).decode(bytes), encoding, source);
  }
});
