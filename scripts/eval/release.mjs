import { runPolicyChecks } from "./policy-checks.mjs";

await runPolicyChecks("release");
console.log("eval:release passed");
