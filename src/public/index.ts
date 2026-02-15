export interface ParserBudgets {
  readonly maxInputBytes?: number;
  readonly maxNodes?: number;
}

export interface ParseOptions {
  readonly budgets?: ParserBudgets;
  readonly seed?: number;
}

export interface ParseNode {
  readonly id: string;
  readonly type: "document" | "text";
  readonly value?: string;
  readonly children?: readonly ParseNode[];
  readonly start: number;
  readonly end: number;
}

export interface ParseResult {
  readonly tree: ParseNode;
  readonly serialization: string;
  readonly nodeCount: number;
}

export interface BudgetExceededPayload {
  readonly code: "BUDGET_EXCEEDED";
  readonly budget: "maxInputBytes" | "maxNodes";
  readonly limit: number;
  readonly actual: number;
}

export class BudgetExceededError extends Error {
  readonly payload: BudgetExceededPayload;

  constructor(payload: BudgetExceededPayload) {
    super(
      `Budget exceeded: ${payload.budget} limit=${String(payload.limit)} actual=${String(payload.actual)}`
    );
    this.name = "BudgetExceededError";
    this.payload = payload;
  }
}

function ensureBudget(
  budget: "maxInputBytes" | "maxNodes",
  limit: number | undefined,
  actual: number
): void {
  if (limit === undefined) {
    return;
  }

  if (actual <= limit) {
    return;
  }

  throw new BudgetExceededError({
    code: "BUDGET_EXCEEDED",
    budget,
    limit,
    actual
  });
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function nodeId(seed: number, kind: string, start: number, end: number, value: string): string {
  return fnv1a(
    `${String(seed)}:${kind}:${String(start)}:${String(end)}:${value}`
  );
}

export function parseString(input: string, options: ParseOptions = {}): ParseResult {
  const budgets = options.budgets ?? {};
  const seed = options.seed ?? 1;

  ensureBudget("maxInputBytes", budgets.maxInputBytes, input.length);

  const textNode: ParseNode = {
    id: nodeId(seed, "text", 0, input.length, input),
    type: "text",
    value: input,
    start: 0,
    end: input.length
  };

  const tree: ParseNode = {
    id: nodeId(seed, "document", 0, input.length, "document"),
    type: "document",
    children: [textNode],
    start: 0,
    end: input.length
  };

  const nodeCount = 2;
  ensureBudget("maxNodes", budgets.maxNodes, nodeCount);

  return {
    tree,
    serialization: input,
    nodeCount
  };
}

function decodeWithSniff(bytes: Uint8Array): string {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }

  return new TextDecoder("utf-8").decode(bytes);
}

export function parseBytes(bytes: Uint8Array, options: ParseOptions = {}): ParseResult {
  const decoded = decodeWithSniff(bytes);
  return parseString(decoded, options);
}

export function serialize(input: ParseResult | ParseNode): string {
  if ("serialization" in input) {
    return input.serialization;
  }

  if (input.type === "text") {
    return input.value ?? "";
  }

  return (input.children ?? []).map((node) => serialize(node)).join("");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableValue(entry));
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const out: Record<string, unknown> = {};

    for (const key of keys) {
      out[key] = stableValue(record[key]);
    }

    return out;
  }

  return value;
}

export function deterministicHash(result: ParseResult): string {
  return fnv1a(JSON.stringify(stableValue(result)));
}

export function parseHtml(input: string, options: ParseOptions = {}): ParseResult {
  return parseString(input, options);
}
