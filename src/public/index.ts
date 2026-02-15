import { POLICY_BASELINE } from "../internal/version.js";

export interface ParseResult {
  readonly html: string;
  readonly policyBaseline: string;
}

export function parseHtml(html: string): ParseResult {
  return {
    html,
    policyBaseline: POLICY_BASELINE
  };
}
