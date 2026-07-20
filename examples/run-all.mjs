/** Runs every repository example. Run after `npm run build`. */
import { runParseSuccessPath } from "./parse-success-path.mjs";
import { runParseStreamBudget } from "./parse-stream-budget.mjs";
import { runPatchPlanUpdate } from "./patch-plan-update.mjs";

runParseSuccessPath();
await runParseStreamBudget();
runPatchPlanUpdate();

console.log("examples:run ok");
