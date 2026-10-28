import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { withStudyLock } from "@/db/client";
import { audit } from "@/db/audit";
import { payoutItems, RELEASED_ITEM_STATUSES, respondents, reviewVotes } from "@/db/schema";
import type { Study } from "@/db/queries";
import { recordDecision } from "@/decisions/service";
import { normalizeEmail, normalizePhone } from "@/engine/normalize";
import { syncReservations } from "@/ledger/ledger";

export class ReviewError extends Error {}

export type ReviewOutcome = { status: "decided"; decision: "pay" | "dont_pay" } | { status: "waiting_for_second" } | { status: "disagree" };

const MIN_OVERRIDE_JUSTIFICATION = 20;

async function findRespondent(studyId: string, ref: string, tx: Parameters<Parameters<typeof withStudyLock>[1]>[0]) {
  const [row] = await tx
    .select()
    .from(respondents)
    .where(and(eq(respondents.studyId, studyId), eq(respondents.respondentRef, ref)));
  if (!row) {
    throw new ReviewError("Respondent not found.");
  }
  return row;
}

/**
 * Records a reviewer's decision on a held respondent, or an override of a rules-based Don't pay.
 * In two-reviewer mode the decision only takes effect once a second, different reviewer agrees.
 */
export async function decide(study: Study, ref: string, decision: "pay" | "dont_pay", reason: string, reviewer: string): Promise<ReviewOutcome> {
  const text = reason.trim();
  if (text.length < 3) {
    throw new ReviewError("Give a reason for this decision.");
  }
  return withStudyLock(study.id, async (tx) => {
    const person = await findRespondent(study.id, ref, tx);
    const isOverride = person.currentDecision === "dont_pay" && person.currentDecisionSource === "rules";
    if (person.currentDecision !== "hold" && !isOverride) {
      throw new ReviewError(`${ref} is not waiting for review.`);
    }
    if (isOverride && decision === "dont_pay") {
      throw new ReviewError(`${ref} is already Don't pay by rule.`);
    }
    if (isOverride && text.length < MIN_OVERRIDE_JUSTIFICATION) {
      throw new ReviewError(`Overriding a locked rule needs a written justification of at least ${MIN_OVERRIDE_JUSTIFICATION} characters. It appears in the ethics report.`);
    }

    let outcome: ReviewOutcome;
    if (!study.twoReviewerMode) {
      await recordDecision(tx, {
        studyId: study.id,
        respondentId: person.id,
        decision,
        source: "reviewer",
        reasons: [{ summary: text }],
        decidedBy: reviewer,
        justification: text,
        isOverride,
      });
      outcome = { status: "decided", decision };
    } else {
      const open = await tx.select().from(reviewVotes).where(and(eq(reviewVotes.respondentId, person.id), isNull(reviewVotes.resolvedDecisionId)));
      if (open.some((vote) => vote.reviewer.toLowerCase() === reviewer.toLowerCase())) {
        throw new ReviewError("You already reviewed this response. Two-reviewer mode needs a second, different reviewer.");
      }
      await tx.insert(reviewVotes).values({ studyId: study.id, respondentId: person.id, reviewer, decision, reason: text });
      const agreeing = open.find((vote) => vote.decision === decision);
      if (agreeing) {
        const decisionId = await recordDecision(tx, {
          studyId: study.id,
          respondentId: person.id,
          decision,
          source: "reviewer",
          reasons: [{ summary: agreeing.reason }, { summary: text }],
          decidedBy: agreeing.reviewer,
          justification: `${agreeing.reviewer}: ${agreeing.reason} · ${reviewer}: ${text}`,
          isOverride,
          secondReviewer: reviewer,
        });
        await tx.update(reviewVotes).set({ resolvedDecisionId: decisionId }).where(and(eq(reviewVotes.respondentId, person.id), isNull(reviewVotes.resolvedDecisionId)));
        outcome = { status: "decided", decision };
      } else {
        outcome = open.length > 0 ? { status: "disagree" } : { status: "waiting_for_second" };
      }
    }
    await syncReservations(tx, study.id, "review");
    await audit(tx, {
      workspaceId: study.workspaceId,
      studyId: study.id,
      actor: reviewer,
      action: isOverride ? "review.override" : "review.decided",
      target: ref,
      before: { decision: person.currentDecision, source: person.currentDecisionSource },
      after: { decision, reason: text, outcome: outcome.status },
    });
    return outcome;
  });
}

/** Fixes a payout email/phone (e.g. a typo after a failed payout). The old and new values are kept in the audit log. */
export async function correctIdentity(study: Study, ref: string, value: string, reason: string, reviewer: string): Promise<void> {
  if (reason.trim().length < 3) {
    throw new ReviewError("Give a reason for the correction.");
  }
  const trimmed = value.trim();
  const isEmail = trimmed.includes("@");
  const normalized = isEmail ? normalizeEmail(trimmed) : normalizePhone(trimmed);
  if (!normalized) {
    throw new ReviewError(isEmail ? "That is not a valid email address." : "That is not a valid phone number.");
  }
  await withStudyLock(study.id, async (tx) => {
    const person = await findRespondent(study.id, ref, tx);
    const [live] = await tx
      .select({ id: payoutItems.id })
      .from(payoutItems)
      .where(and(eq(payoutItems.respondentId, person.id), sql`${payoutItems.status} not in (${sql.join(RELEASED_ITEM_STATUSES.map((status) => sql`${status}`), sql`, `)})`));
    if (live) {
      throw new ReviewError("This respondent has a payout in progress or completed; the address cannot change now.");
    }
    const [clash] = await tx
      .select({ ref: respondents.respondentRef })
      .from(respondents)
      .where(and(eq(respondents.studyId, study.id), eq(respondents.payoutIdentityNormalized, normalized), ne(respondents.id, person.id)));
    await tx
      .update(respondents)
      .set({ payoutIdentityRaw: trimmed, payoutIdentityNormalized: normalized, payoutIdentityType: isEmail ? "email" : "phone" })
      .where(eq(respondents.id, person.id));
    await audit(tx, {
      workspaceId: study.workspaceId,
      studyId: study.id,
      actor: reviewer,
      action: "identity.corrected",
      target: ref,
      before: { type: person.payoutIdentityType },
      after: { type: isEmail ? "email" : "phone", reason, sameAs: clash?.ref ?? null },
    });
  });
}
