import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { checks, decisions, payoutItems, respondents, reviewVotes } from "@/db/schema";
import { studyQuestionMap, type Study } from "@/db/queries";
import { maskIdentity } from "@/engine/normalize";
import { ROLE_LABELS, type ColumnRole } from "@/engine/roles";
import type { Evidence } from "@/engine/types";

const MASKED_ROLES = new Set<ColumnRole>(["payout_email", "payout_phone"]);

export interface RespondentDetail {
  ref: string;
  rowNumber: number;
  submittedAt: string | null;
  durationSeconds: number | null;
  identity: { type: string; masked: string } | null;
  decision: string | null;
  decisionSource: string | null;
  fields: { column: string; role: string; roleLabel: string; value: string; masked: boolean; questionText: string | null }[];
  checks: { ruleId: string; layer: string; outcome: string; evidence: Evidence }[];
  decisions: { decision: string; source: string; decidedBy: string; decidedAt: string; reasons: { summary: string }[]; justification: string | null; isOverride: boolean; secondReviewer: string | null }[];
  votes: { reviewer: string; decision: string; reason: string; at: string }[];
  linkedAnswers: Record<string, { ref: string; text: string }[]>;
  payouts: { status: string; senderItemId: string; amountCents: number; at: string }[];
}

export async function respondentDetail(study: Study, ref: string): Promise<RespondentDetail | null> {
  const [row] = await db()
    .select()
    .from(respondents)
    .where(and(eq(respondents.studyId, study.id), eq(respondents.respondentRef, ref)));
  if (!row) {
    return null;
  }
  const [map, checkRows, decisionRows, voteRows, itemRows] = await Promise.all([
    studyQuestionMap(study.id),
    db().select().from(checks).where(eq(checks.respondentId, row.id)).orderBy(asc(checks.ruleId)),
    db().select().from(decisions).where(eq(decisions.respondentId, row.id)).orderBy(desc(decisions.decidedAt)),
    db().select().from(reviewVotes).where(eq(reviewVotes.respondentId, row.id)).orderBy(desc(reviewVotes.createdAt)),
    db().select().from(payoutItems).where(eq(payoutItems.respondentId, row.id)).orderBy(desc(payoutItems.createdAt)),
  ]);

  const linkedAnswers: Record<string, { ref: string; text: string }[]> = {};
  for (const check of checkRows.filter((entry) => entry.layer === "similarity")) {
    const evidence = check.evidenceJson as Evidence;
    const column = String(evidence.values?.column ?? "");
    const refs = (evidence.linkedRefs ?? []).slice(0, 6);
    if (!column || refs.length === 0) {
      continue;
    }
    const others = await db()
      .select({ ref: respondents.respondentRef, raw: respondents.rawJson })
      .from(respondents)
      .where(and(eq(respondents.studyId, study.id), inArray(respondents.respondentRef, refs)));
    linkedAnswers[column] = others.map((other) => ({ ref: other.ref, text: other.raw[column] ?? "" }));
  }

  return {
    ref: row.respondentRef,
    rowNumber: row.rowNumber,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    durationSeconds: row.durationSeconds,
    identity: row.payoutIdentityType && row.payoutIdentityRaw ? { type: row.payoutIdentityType, masked: maskIdentity(row.payoutIdentityRaw) } : null,
    decision: row.currentDecision,
    decisionSource: row.currentDecisionSource,
    fields: map.map((entry) => {
      const role = entry.role as ColumnRole;
      const value = row.rawJson[entry.columnName] ?? "";
      const masked = MASKED_ROLES.has(role) && value.length > 0;
      return { column: entry.columnName, role, roleLabel: ROLE_LABELS[role] ?? role, value: masked ? maskIdentity(value) : value, masked, questionText: entry.questionText };
    }),
    checks: checkRows.map((entry) => ({ ruleId: entry.ruleId, layer: entry.layer, outcome: entry.outcome, evidence: entry.evidenceJson as Evidence })),
    decisions: decisionRows.map((entry) => ({
      decision: entry.decision,
      source: entry.source,
      decidedBy: entry.decidedBy,
      decidedAt: entry.decidedAt.toISOString(),
      reasons: entry.reasonsJson as { summary: string }[],
      justification: entry.justification,
      isOverride: entry.isOverride,
      secondReviewer: entry.secondReviewer,
    })),
    votes: voteRows.map((entry) => ({ reviewer: entry.reviewer, decision: entry.decision, reason: entry.reason, at: entry.createdAt.toISOString() })),
    linkedAnswers,
    payouts: itemRows.map((entry) => ({ status: entry.status, senderItemId: entry.senderItemId, amountCents: entry.amountCents, at: (entry.lastEventAt ?? entry.createdAt).toISOString() })),
  };
}
