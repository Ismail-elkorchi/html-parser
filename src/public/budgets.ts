import { HtmlBudgetExceededError } from "./errors.ts";

import type { HtmlBudgetName } from "./types.ts";

/** Enforces an inclusive public resource limit at its first unavailable unit. */
export function enforceBudget(
  budget: HtmlBudgetName,
  limit: number | undefined,
  actual: number
): void {
  if (limit !== undefined && actual > limit) {
    throw new HtmlBudgetExceededError(budget, limit, limit + 1);
  }
}
