import { runPolicyChecks } from "./policy-checks.mjs";

await runPolicyChecks("ci");
console.log("ACT: eval:ci passed");
