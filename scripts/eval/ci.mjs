import { runPolicyChecks } from "./policy-checks.mjs";

await runPolicyChecks("ci");
console.log("eval:ci passed");
