import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, normalize, resolve } from "node:path";

import { chromium } from "playwright";

const DEFAULT_REPORT_PATH = "reports/smoke-browser.json";
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

function parseArgs(argv) {
  let reportPath = DEFAULT_REPORT_PATH;
  for (const arg of argv) {
    if (arg.startsWith("--report=")) {
      reportPath = arg.slice("--report=".length);
    }
  }
  return { reportPath };
}

function encodeHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text) {
  const payload = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
  return encodeHex(new Uint8Array(digest));
}

function createStaticServer(rootDir) {
  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
      const unsafePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
      const absolutePath = resolve(rootDir, `.${unsafePath}`);
      if (!absolutePath.startsWith(rootDir)) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        response.end("forbidden");
        return;
      }

      if (pathname === "/index.html") {
        response.writeHead(200, { "content-type": MIME_TYPES[".html"] });
        response.end("<!doctype html><meta charset=\"utf-8\"><title>browser-smoke</title>", "utf8");
        return;
      }

      const content = await readFile(absolutePath);
      const contentType = MIME_TYPES[extname(absolutePath)] ?? "application/octet-stream";
      response.writeHead(200, { "content-type": contentType });
      response.end(content);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code === "ENOENT") {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("internal error");
    }
  });
}

async function runBrowserSmoke(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    const smoke = await page.evaluate(async () => {
      const mod = await import("/dist/mod.js");
      const sampleHtml = "<!doctype html><html><head><title>t</title></head><body><p>smoke</p></body></html>";
      const streamFromText = (value) => {
        const bytes = new TextEncoder().encode(value);
        return new globalThis.ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          }
        });
      };

      const parsed = mod.parse(sampleHtml, { captureSpans: true });
      const serialized = mod.serialize(parsed);
      const parsedBytes = mod.parseBytes(new TextEncoder().encode(sampleHtml));
      const bytesSerialized = mod.serialize(parsedBytes);
      const fragment = mod.parseFragment("child", "section");
      const streamParsed = await mod.parseStream(streamFromText(sampleHtml));
      const streamSerialized = mod.serialize(streamParsed);

      const tokenKinds = [];
      for await (const token of mod.tokenizeStream(streamFromText(sampleHtml))) {
        tokenKinds.push(token.kind);
      }

      const stablePayload = {
        serialized,
        bytesSerialized,
        streamSerialized,
        fragmentContextTagName: fragment.contextTagName,
        tokenKinds
      };
      const hashBuffer = await globalThis.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(stablePayload))
      );
      const hash = Array.from(new Uint8Array(hashBuffer), (value) => value.toString(16).padStart(2, "0")).join("");
      const checks = {
        exportsPresent: typeof mod.parse === "function" &&
          typeof mod.parseBytes === "function" &&
          typeof mod.parseFragment === "function" &&
          typeof mod.parseStream === "function" &&
          typeof mod.serialize === "function" &&
          typeof mod.tokenizeStream === "function",
        parseSerialize: serialized.includes("<p>smoke</p>"),
        parseBytes: bytesSerialized.includes("<p>smoke</p>"),
        parseStream: streamSerialized.includes("<p>smoke</p>"),
        parseFragment: fragment.contextTagName === "section",
        tokenizeStream: tokenKinds.includes("startTag") && tokenKinds.includes("endTag")
      };
      const ok = Object.values(checks).every((value) => value === true);
      return {
        ok,
        checks,
        hash,
        userAgent: globalThis.navigator.userAgent
      };
    });

    return {
      ok: smoke.ok === true,
      checks: smoke.checks,
      hash: String(smoke.hash ?? ""),
      userAgent: String(smoke.userAgent ?? ""),
      version: browser.version()
    };
  } finally {
    await page.close();
    await browser.close();
  }
}

async function main() {
  const { reportPath } = parseArgs(process.argv.slice(2));
  const rootDir = resolve(".");
  const server = createStaticServer(rootDir);
  await new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to resolve browser smoke server address");
    }
    const baseUrl = `http://127.0.0.1:${String(address.port)}`;
    const smoke = await runBrowserSmoke(baseUrl);
    const report = {
      suite: "smoke-runtime",
      runtime: "browser",
      timestamp: new Date().toISOString(),
      ok: smoke.ok,
      version: smoke.version,
      userAgent: smoke.userAgent,
      hash: smoke.hash,
      determinismHash: smoke.hash,
      checks: smoke.checks
    };

    const reportAbsolutePath = resolve(reportPath);
    await mkdir(dirname(reportAbsolutePath), { recursive: true });
    await writeFile(reportAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    if (!report.ok) {
      throw new Error("browser smoke checks failed");
    }
    const reportDigest = await sha256Hex(JSON.stringify(report));
    process.stdout.write(`browser smoke passed: ${reportPath} digest=${reportDigest}\n`);
  } finally {
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      });
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
