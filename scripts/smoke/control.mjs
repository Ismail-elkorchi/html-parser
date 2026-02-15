import {
  BudgetExceededError,
  chunk,
  outline,
  parseBytes,
  parse,
  parseFragment,
  serialize
} from "../../dist/mod.js";

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const parsed = parse("<p>smoke</p>");
ensure(parsed.kind === "document", "parse root type mismatch");
ensure(serialize(parsed) === "<html><p>smoke</p></html>", "parse output mismatch");

const fromBytes = parseBytes(new Uint8Array([0x68, 0x74, 0x6d, 0x6c]));
ensure(serialize(fromBytes) === "<html>html</html>", "parseBytes decoding mismatch");

const serialized = serialize(parsed);
ensure(serialized === "<html><p>smoke</p></html>", "serialize mismatch");

const first = parse("deterministic");
const second = parse("deterministic");
ensure(JSON.stringify(first) === JSON.stringify(second), "deterministic output mismatch");

const fragment = parseFragment("child", "section");
ensure(fragment.contextTagName === "section", "fragment context mismatch");

const out = outline(parsed);
ensure(out.entries.length === 1, "outline generation mismatch");

const chunks = chunk(parsed);
ensure(chunks.length === 1, "chunk generation mismatch");

let budgetError = null;
try {
  parse("budget", { budgets: { maxInputBytes: 3 } });
} catch (error) {
  budgetError = error;
}

ensure(budgetError instanceof BudgetExceededError, "expected BudgetExceededError");
ensure(budgetError.payload.code === "BUDGET_EXCEEDED", "expected structured budget code");

console.log("control smoke passed");
