import { runPolicyChecks } from "./policy-checks.mjs";

await runPolicyChecks("release");
console.log("ACT: eval:release passed");
