import type { Check, Decision } from "@/engine/types";

export interface Reason {
  ruleId: string;
  layer: Check["layer"];
  outcome: Check["outcome"];
  summary: string;
}

export interface CombinedDecision {
  decision: Decision;
  reasons: Reason[];
}

export class ExcludeGuardError extends Error {
  constructor(check: Check) {
    super(`Check ${check.ruleId} from the ${check.layer} layer tried to exclude. Only locked rules may exclude.`);
    this.name = "ExcludeGuardError";
  }
}

function toReason(check: Check): Reason {
  return { ruleId: check.ruleId, layer: check.layer, outcome: check.outcome, summary: check.evidence.summary };
}

/**
 * The decision model:
 * 1. Any exclude from a locked deterministic rule → Don't pay.
 * 2. Otherwise any review from any layer → Hold for review.
 * 3. Otherwise → Pay.
 * Similarity, AI and system checks can never exclude; this is enforced by type and checked again here.
 */
export function combine(checks: readonly Check[]): CombinedDecision {
  for (const check of checks) {
    if (check.outcome === "exclude" && check.source !== "rule") {
      throw new ExcludeGuardError(check);
    }
  }
  const excludes = checks.filter((check) => check.outcome === "exclude");
  const reviews = checks.filter((check) => check.outcome === "review");
  if (excludes.length > 0) {
    return { decision: "dont_pay", reasons: [...excludes, ...reviews].map(toReason) };
  }
  if (reviews.length > 0) {
    return { decision: "hold", reasons: reviews.map(toReason) };
  }
  return { decision: "pay", reasons: checks.filter((check) => check.outcome === "note").map(toReason) };
}
