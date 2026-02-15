import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { builtinModules } from "node:module";
import { nowIso, writeJson } from "./util.mjs";

const SRC_DIR = "src";

// Create a set of builtin names including both `fs` and `node:fs`
const BUILTINS = new Set(
  builtinModules.flatMap((m) => (m.startsWith("node:") ? [m, m.slice(5)] : [m, `node:${m}`]))
);

async function listFiles(dir) {
  const out = [];
  async function walk(p) {
    const s = await stat(p);
    if (s.isDirectory()) {
      const entries = await readdir(p);
      for (const e of entries) await walk(join(p, e));
      return;
    }
    if (s.isFile() && (p.endsWith(".ts") || p.endsWith(".mts") || p.endsWith(".tsx"))) out.push(p);
  }
  await walk(dir);
  return out;
}

function extractImportSpecifiers(text) {
  const specs = [];
  const re1 = /\bimport\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g;
  const re2 = /\bimport\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re1.exec(text))) specs.push(m[1]);
  while ((m = re2.exec(text))) specs.push(m[1]);
  return specs;
}

async function main() {
  const findings = [];

  let files = [];
  try {
    files = await listFiles(SRC_DIR);
  } catch {
    const report = {
      suite: "no-node-builtins",
      timestamp: nowIso(),
      ok: false,
      reason: "src/ directory not found",
      findings: []
    };
    await writeJson("reports/no-node-builtins.json", report);
    process.exit(1);
  }

  for (const file of files) {
    const text = await readFile(file, "utf8");

    if (/\brequire\s*\(/.test(text)) {
      findings.push({ file, kind: "require", message: "require(...) found in src runtime code" });
    }

    const specs = extractImportSpecifiers(text);
    for (const s of specs) {
      if (BUILTINS.has(s)) {
        findings.push({ file, kind: "builtin-import", specifier: s, message: "Node builtin import found in src runtime code" });
      }
    }
  }

  const ok = findings.length === 0;
  const report = {
    suite: "no-node-builtins",
    timestamp: nowIso(),
    ok,
    checkedFiles: files.length,
    findings
  };

  await writeJson("reports/no-node-builtins.json", report);

  if (!ok) {
    console.error("Node builtin usage detected in src/:", findings);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
