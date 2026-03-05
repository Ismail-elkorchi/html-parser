/**
 * What it does: runs all README-linked examples as a single smoke check.
 * Expected output: prints "examples:run ok" when every example assertion passes.
 * Constraints: all individual example modules must succeed in the same Node process.
 * Run: npm run build && node examples/run-all.mjs
 */
import { runParseSuccessPath } from "./parse-success-path.mjs";
import { runParseStreamBudget } from "./parse-stream-budget.mjs";
import { runPatchPlanUpdate } from "./patch-plan-update.mjs";

runParseSuccessPath();
await runParseStreamBudget();
runPatchPlanUpdate();

console.log("examples:run ok");
