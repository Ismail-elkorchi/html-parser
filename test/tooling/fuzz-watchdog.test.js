import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

void test("the fuzz watchdog terminates a controlled stalled worker", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/fuzz/run-fuzz.mjs", "--probe-watchdog"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, HTML_PARSER_FUZZ_WATCHDOG_MS: "50" },
      timeout: 5_000
    }
  );
  const result = JSON.parse(output);
  assert.equal(result.passed, true);
  assert.equal(result.report.hangs, 1);
  assert.equal(result.report.findings[0].case.id, "watchdog-probe");
});

void test("fuzz worker modes cannot be combined", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/fuzz/run-fuzz.mjs", "--worker", "--probe-watchdog"],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /worker modes are mutually exclusive/);
});
