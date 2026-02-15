import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileExists, readJson } from "./util.mjs";

async function main() {
  const profile = (process.argv.find((a) => a.startsWith("--profile=")) || "--profile=ci").split("=")[1];

  const gates = (await fileExists("reports/gates.json")) ? await readJson("reports/gates.json") : null;
  const score = (await fileExists("reports/score.json")) ? await readJson("reports/score.json") : null;
  const conformanceReports = await Promise.all(
    [
      "reports/tokenizer.json",
      "reports/tree.json",
      "reports/encoding.json",
      "reports/serializer.json",
      "reports/holdout.json"
    ].map(async (path) => ((await fileExists(path)) ? readJson(path) : null))
  );

  const lines = [];
  lines.push(`# Evaluation report (${profile})`);
  lines.push("");
  lines.push(`Generated from JSON reports under \`reports/\`.`);
  lines.push("");

  if (!gates) {
    lines.push("## Gates");
    lines.push("");
    lines.push("- No gates report found (`reports/gates.json`).");
  } else {
    lines.push("## Gates");
    lines.push("");
    lines.push(`Overall: **${gates.allPass ? "PASS" : "FAIL"}**`);
    lines.push("");
    for (const g of gates.gates || []) {
      lines.push(`- **${g.id}** ${g.name}: ${g.pass ? "PASS" : "FAIL"}`);
      if (!g.pass) {
        lines.push(`  - details: \`${JSON.stringify(g.details).slice(0, 400)}\``);
      }
    }
  }

  lines.push("");

  if (!score) {
    lines.push("## Score");
    lines.push("");
    lines.push("- No score report found (`reports/score.json`).");
  } else {
    lines.push("## Score");
    lines.push("");
    lines.push(`Total: **${score.total.toFixed(3)} / 100**`);
    lines.push("");
    const b = score.breakdown || {};
    for (const key of Object.keys(b)) {
      const item = b[key];
      lines.push(`- **${key}**: ${Number(item.score || 0).toFixed(3)}`);
    }
  }

  lines.push("");
  lines.push("## Decision records required");
  lines.push("");
  lines.push("- Any fixture skip MUST have an ADR (ADR-001).");
  lines.push("- Any threshold or gate change MUST have an ADR (ADR-002).");
  lines.push("- Any oracle choice or normalization rule MUST have an ADR (ADR-003).");
  lines.push("- Any dataset update MUST have an ADR (ADR-004).");
  lines.push("- Any dev dependency addition MUST have an ADR (ADR-005) and a debt entry in docs/debt.md.");
  lines.push("");

  const decisionRecords = new Set([
    "docs/decisions/ADR-002-staged-threshold-realignment.md",
    "docs/decisions/ADR-003-browser-diff-normalization-v1.md"
  ]);

  for (const report of conformanceReports) {
    if (!report) {
      continue;
    }
    for (const skip of report.skips || []) {
      if (typeof skip?.decisionRecord === "string" && skip.decisionRecord.length > 0) {
        decisionRecords.add(skip.decisionRecord);
      }
    }
  }

  lines.push("## Decision records referenced");
  lines.push("");
  for (const record of [...decisionRecords].sort()) {
    lines.push(`- ${record}`);
  }
  lines.push("");

  const out = lines.join("\n") + "\n";
  await mkdir(dirname("docs/score-report.md"), { recursive: true });
  await writeFile("docs/score-report.md", out, "utf8");

  console.log("Wrote docs/score-report.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
