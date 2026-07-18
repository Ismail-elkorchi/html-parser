import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileExists, readJson } from "./eval-primitives.mjs";

function parseProfileArg() {
  const profileArg = process.argv.find((argumentValue) => argumentValue.startsWith("--profile="));
  return profileArg ? profileArg.split("=")[1] : "ci";
}

async function main() {
  const profile = parseProfileArg();

  const gatesReport = (await fileExists("reports/gates.json")) ? await readJson("reports/gates.json") : null;
  const scoreReport = (await fileExists("reports/score.json")) ? await readJson("reports/score.json") : null;
  const lines = [];
  lines.push(`# Evaluation report (${profile})`);
  lines.push("");
  lines.push(`Generated from JSON reports under \`reports/\`.`);
  lines.push("");

  if (!gatesReport) {
    lines.push("## Gates");
    lines.push("");
    lines.push("- No gates report found (`reports/gates.json`).");
  } else {
    lines.push("## Gates");
    lines.push("");
    lines.push(`Overall: **${gatesReport.allPass ? "PASS" : "FAIL"}**`);
    lines.push("");
    for (const gateResult of gatesReport.gates || []) {
      lines.push(`- **${gateResult.id}** ${gateResult.name}: ${gateResult.pass ? "PASS" : "FAIL"}`);
      if (!gateResult.pass) {
        lines.push(`  - details: \`${JSON.stringify(gateResult.details).slice(0, 400)}\``);
      }
    }
  }

  lines.push("");

  if (!scoreReport) {
    lines.push("## Score");
    lines.push("");
    lines.push("- No score report found (`reports/score.json`).");
  } else {
    lines.push("## Score");
    lines.push("");
    lines.push(`Total: **${scoreReport.total.toFixed(3)} / 100**`);
    lines.push("");
    const weightsUsed = scoreReport.weightsUsed;
    if (weightsUsed && typeof weightsUsed === "object") {
      lines.push(`Weights source: \`${weightsUsed.source}\``);
      lines.push(`Weights total: \`${Number(weightsUsed.total || 0).toFixed(3)}\``);
      lines.push("");
      lines.push("Weights:");
      for (const [weightKey, weightValue] of Object.entries(weightsUsed.values || {})) {
        lines.push(`- **${weightKey}**: ${Number(weightValue).toFixed(3)}`);
      }
      lines.push("");
    }
    const scoreBreakdown = scoreReport.breakdown || {};
    for (const scoreKey of Object.keys(scoreBreakdown)) {
      const scoreItem = scoreBreakdown[scoreKey];
      lines.push(`- **${scoreKey}**: ${Number(scoreItem.score || 0).toFixed(3)}`);
    }
  }

  const markdownOutput = lines.join("\n") + "\n";
  await mkdir(dirname("reports/eval-report.md"), { recursive: true });
  await writeFile("reports/eval-report.md", markdownOutput, "utf8");

  console.log("Wrote reports/eval-report.md");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
