import "server-only";
import { eq } from "drizzle-orm";
import type { Transaction } from "@/db/client";
import { decisions, respondents } from "@/db/schema";
import type { Reason } from "@/engine/combine";
import type { Decision } from "@/engine/types";

export interface DecisionInput {
  studyId: string;
  respondentId: string;
  decision: Decision;
  source: "rules" | "reviewer" | "payout";
  reasons: Reason[] | { summary: string }[];
  decidedBy: string;
  justification?: string | null;
  isOverride?: boolean;
  secondReviewer?: string | null;
}

/** Appends a decision (history is never rewritten) and makes it the respondent's current one. */
export async function recordDecision(tx: Transaction, input: DecisionInput): Promise<string> {
  const now = new Date();
  const [row] = await tx
    .insert(decisions)
    .values({
      studyId: input.studyId,
      respondentId: input.respondentId,
      decision: input.decision,
      source: input.source,
      reasonsJson: input.reasons,
      decidedBy: input.decidedBy,
      decidedAt: now,
      justification: input.justification ?? null,
      isOverride: input.isOverride ?? false,
      secondReviewer: input.secondReviewer ?? null,
      secondDecidedAt: input.secondReviewer ? now : null,
    })
    .returning({ id: decisions.id });
  if (!row) {
    throw new Error("The decision could not be saved.");
  }
  await tx.update(respondents).set({ currentDecision: input.decision, currentDecisionSource: input.source }).where(eq(respondents.id, input.respondentId));
  return row.id;
}
