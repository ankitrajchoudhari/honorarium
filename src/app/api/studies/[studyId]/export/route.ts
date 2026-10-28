import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { decisions, respondents } from "@/db/schema";
import { getStudy } from "@/db/queries";
import { toCsv } from "@/lib/csv";
import { currentWorkspace } from "@/lib/session";

/** Decisions export for the ethics file. Pseudonymous refs only; formula-leading cells are escaped. */
export async function GET(_: Request, context: RouteContext<"/api/studies/[studyId]/export">) {
  const { studyId } = await context.params;
  const workspace = await currentWorkspace();
  const study = workspace ? await getStudy(workspace.id, studyId) : null;
  if (!study) {
    return new Response("Study not found.", { status: 404 });
  }
  const latest = db()
    .selectDistinctOn([decisions.respondentId], {
      respondentId: decisions.respondentId,
      reasons: decisions.reasonsJson,
      decidedBy: decisions.decidedBy,
      source: decisions.source,
      isOverride: decisions.isOverride,
    })
    .from(decisions)
    .where(eq(decisions.studyId, study.id))
    .orderBy(decisions.respondentId, desc(decisions.decidedAt))
    .as("latest");
  const rows = await db()
    .select({
      ref: respondents.respondentRef,
      submittedAt: respondents.submittedAt,
      decision: respondents.currentDecision,
      decidedBy: latest.decidedBy,
      source: latest.source,
      isOverride: latest.isOverride,
      reasons: latest.reasons,
    })
    .from(respondents)
    .leftJoin(latest, eq(latest.respondentId, respondents.id))
    .where(eq(respondents.studyId, study.id))
    .orderBy(asc(respondents.rowNumber));
  const csv = toCsv([
    ["respondent_ref", "submitted_at_utc", "decision", "decided_by", "source", "override", "reasons"],
    ...rows.map((row) => [
      row.ref,
      row.submittedAt?.toISOString() ?? "",
      row.decision ?? "",
      row.decidedBy ?? "",
      row.source ?? "",
      row.isOverride ? "yes" : "no",
      ((row.reasons as { summary: string }[] | null) ?? []).map((reason) => reason.summary).join(" | "),
    ]),
  ]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${study.shortCode}-decisions.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
