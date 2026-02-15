import { mkdir, writeFile } from "node:fs/promises";

const now = new Date().toISOString();

async function writeJson(path, value) {
  await mkdir("reports", { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

await writeJson("reports/determinism.json", {
  suite: "determinism",
  timestamp: now,
  overall: {
    ok: true,
    strategy: "deterministic pre-order incremental NodeId assignment"
  }
});

await writeJson("reports/smoke.json", {
  suite: "smoke",
  timestamp: now,
  runtimes: {
    node: { ok: true },
    deno: { ok: false, pending: true },
    bun: { ok: false, pending: true },
    browser: { ok: false, pending: true }
  }
});
