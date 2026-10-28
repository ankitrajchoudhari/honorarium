import type { ColumnRole } from "@/engine/roles";

export type Outcome = "pass" | "note" | "review" | "exclude";
export type NonExcludingOutcome = Exclude<Outcome, "exclude">;
export type Layer = "deterministic" | "similarity" | "ai";
export type Decision = "pay" | "hold" | "dont_pay";

export type PayoutIdentityType = "email" | "phone";

export interface PayoutIdentity {
  type: PayoutIdentityType;
  raw: string;
  /** Null when the raw value cannot be used for a payout. */
  normalized: string | null;
}

export interface Evidence {
  /** Short chip text, e.g. "Finished in 52s · min 4m". */
  summary: string;
  /** Respondent refs this check links to (duplicates, clusters, bursts). */
  linkedRefs?: string[];
  /** Exact quote from the respondent's own text. */
  quote?: string;
  /** Structured values behind the summary, shown in the drawer. */
  values?: Record<string, string | number | boolean | null>;
}

/** Checks from the locked rule set. Only these may exclude. */
export interface RuleCheck {
  layer: "deterministic";
  source: "rule";
  ruleId: string;
  outcome: Outcome;
  evidence: Evidence;
}

/** Built-in safety checks (duplicate payout identity, unusable payout identity). Never exclude. */
export interface SystemCheck {
  layer: "deterministic";
  source: "system";
  ruleId: SystemCheckId;
  outcome: NonExcludingOutcome;
  evidence: Evidence;
}

/** Similarity and AI layers. The type forbids exclude; combine() also checks at runtime. */
export interface AdvisoryCheck {
  layer: "similarity" | "ai";
  source: "advisory";
  ruleId: string;
  outcome: NonExcludingOutcome;
  evidence: Evidence;
}

export type Check = RuleCheck | SystemCheck | AdvisoryCheck;

export const SYSTEM_CHECK_IDS = ["system:payout_identity", "system:duplicate_identity", "system:instruction_text"] as const;
export type SystemCheckId = (typeof SYSTEM_CHECK_IDS)[number];

/** One survey row as the engine sees it. Values are the exact strings from the CSV. */
export interface EngineRespondent {
  ref: string;
  rowNumber: number;
  values: Record<string, string>;
  submittedAt: Date | null;
  durationSeconds: number | null;
  payout: PayoutIdentity | null;
}

/** Which CSV columns carry which role. */
export type RoleColumns = Partial<Record<ColumnRole, string[]>>;
