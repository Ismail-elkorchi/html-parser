/**
 * Runs all public examples used by README and release checks.
 * Run: npm run build && node examples/run-all.mjs
 */
import { runParseSuccessPath } from "./parse-success-path.mjs";
import { runParseStreamBudget } from "./parse-stream-budget.mjs";
import { runPatchPlanUpdate } from "./patch-plan-update.mjs";

runParseSuccessPath();
await runParseStreamBudget();
runPatchPlanUpdate();

console.log("examples:run ok");
