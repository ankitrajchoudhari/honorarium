import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { LinkButton, Notice, PageTitle } from "@/components/ui";
import { db } from "@/db/client";
import { checks, decisions, respondents } from "@/db/schema";
import { decisionCounts, lockedRuleSet, studyImport } from "@/db/queries";
import { getStudyOr404 } from "@/db/study-page";
import { binSubmissions, checkLabel } from "@/engine/insights";
import { jobState, latestJob } from "@/jobs/verify";
import { requireWorkspace } from "@/lib/session";
import { VerifyView, type ResultRow } from "./verify-view";

export const metadata: Metadata = { title: "Verification" };

export default async function VerifyPage({ params }: PageProps<"/studies/[studyId]/verify">) {
  const { studyId } = await params;
  const workspace = await requireWorkspace();
  const study = await getStudyOr404(workspace.id, studyId);
  const [locked, imported, job] = await Promise.all([lockedRuleSet(study.id), studyImport(study.id), latestJob(study.id)]);

  if (!locked || !imported) {
    return (
      <div className="space-y-4">
        <PageTitle>Verification</PageTitle>
        <Notice tone="info" title={!locked ? "Lock the exclusion rules first" : "Import responses to verify"}>
          {!locked ? "Rules are decided and locked before any responses are imported." : "Verification runs the locked rules, the similarity check and AI review on the imported responses."}
        </Notice>
        <LinkButton href={`/studies/${study.id}/${!locked ? "rules" : "import"}`} variant="primary">
          {!locked ? "Go to rules" : "Import responses"}
        </LinkButton>
      </div>
    );
  }

  const latestReasons = db()
    .selectDistinctOn([decisions.respondentId], { respondentId: decisions.respondentId, reasons: decisions.reasonsJson })
    .from(decisions)
    .where(eq(decisions.studyId, study.id))
    .orderBy(decisions.respondentId, desc(decisions.decidedAt))
    .as("latest");
  const rows = await db()
    .select({
      ref: respondents.respondentRef,
      submittedAt: respondents.submittedAt,
      duration: respondents.durationSeconds,
      decision: respondents.currentDecision,
      source: respondents.currentDecisionSource,
      reasons: latestReasons.reasons,
      checkCount: sql<number>`(select count(*)::int from checks c where c.respondent_id = ${respondents.id} and c.outcome in ('review', 'exclude'))`,
    })
    .from(respondents)
    .leftJoin(latestReasons, eq(latestReasons.respondentId, respondents.id))
    .where(eq(respondents.studyId, study.id))
    .orderBy(asc(respondents.rowNumber));

  const results: ResultRow[] = rows.map((row) => {
    const reasons = (row.reasons as { summary: string }[] | null) ?? [];
    return {
      ref: row.ref,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      durationSeconds: row.duration,
      decision: row.decision,
      source: row.source,
      topReason: reasons[0]?.summary ?? "",
      reasonCount: Math.max(reasons.length, row.checkCount),
    };
  });
  const [counts, state, flagged] = await Promise.all([
    decisionCounts(study.id),
    job ? jobState(workspace.id, job.id) : null,
    db()
      .select({ ruleId: checks.ruleId, outcome: checks.outcome, total: sql<number>`count(*)::int` })
      .from(checks)
      .where(and(eq(checks.studyId, study.id), inArray(checks.outcome, ["exclude", "review"])))
      .groupBy(checks.ruleId, checks.outcome),
  ]);
  const ruleTypes = new Map(locked.rules.rules.map((rule) => [rule.id, rule.type]));
  const reasonMap = new Map<string, { label: string; exclude: number; review: number }>();
  for (const row of flagged) {
    const label = checkLabel(row.ruleId, ruleTypes);
    const entry = reasonMap.get(label) ?? { label, exclude: 0, review: 0 };
    entry[row.outcome === "exclude" ? "exclude" : "review"] += row.total;
    reasonMap.set(label, entry);
  }
  const reasons = [...reasonMap.values()].sort((a, b) => b.exclude + b.review - (a.exclude + a.review));
  const timeline = binSubmissions(rows.map((row) => ({ at: row.submittedAt, decision: row.decision })));

  return (
    <VerifyView
      studyId={study.id}
      results={results}
      counts={counts}
      reasons={reasons}
      timeline={timeline}
      initialJob={state}
      ruleVersion={locked.row.version}
      jobRuleVersion={job ? ((job.cursorJson as { ruleSetVersion?: number }).ruleSetVersion ?? null) : null}
    />
  );
}
