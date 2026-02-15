import {
  BudgetExceededError,
  deterministicHash,
  parseBytes,
  parseString,
  serialize
} from "../../dist/mod.js";

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const parsed = parseString("<p>smoke</p>");
ensure(parsed.serialization === "<p>smoke</p>", "parseString serialization mismatch");
ensure(parsed.tree.type === "document", "parseString root type mismatch");

const fromBytes = parseBytes(new Uint8Array([0x68, 0x74, 0x6d, 0x6c]));
ensure(fromBytes.serialization === "html", "parseBytes decoding mismatch");

const serialized = serialize(parsed);
ensure(serialized === "<p>smoke</p>", "serialize mismatch");

const hashA = deterministicHash(parseString("deterministic", { seed: 7 }));
const hashB = deterministicHash(parseString("deterministic", { seed: 7 }));
ensure(hashA === hashB, "deterministic hash mismatch");

let budgetError = null;
try {
  parseString("budget", { budgets: { maxInputBytes: 3 } });
} catch (error) {
  budgetError = error;
}

ensure(budgetError instanceof BudgetExceededError, "expected BudgetExceededError");
ensure(budgetError.payload.code === "BUDGET_EXCEEDED", "expected structured budget code");

console.log("control smoke passed");
