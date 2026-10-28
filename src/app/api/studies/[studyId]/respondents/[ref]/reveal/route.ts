import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { audit } from "@/db/audit";
import { respondents } from "@/db/schema";
import { getStudy } from "@/db/queries";
import { currentWorkspace, reviewerName } from "@/lib/session";

/** Reveals a payout identity in full. Every reveal is recorded in the audit log. */
export async function POST(_: Request, context: RouteContext<"/api/studies/[studyId]/respondents/[ref]/reveal">) {
  const { studyId, ref } = await context.params;
  const workspace = await currentWorkspace();
  const study = workspace ? await getStudy(workspace.id, studyId) : null;
  if (!workspace || !study) {
    return NextResponse.json({ error: "Study not found." }, { status: 404 });
  }
  const [row] = await db()
    .select({ raw: respondents.payoutIdentityRaw })
    .from(respondents)
    .where(and(eq(respondents.studyId, study.id), eq(respondents.respondentRef, decodeURIComponent(ref))));
  if (!row) {
    return NextResponse.json({ error: "Respondent not found." }, { status: 404 });
  }
  await audit(db(), { workspaceId: workspace.id, studyId: study.id, actor: (await reviewerName()) ?? "Visitor", action: "identity.revealed", target: decodeURIComponent(ref) });
  return NextResponse.json({ identity: row.raw }, { headers: { "Cache-Control": "no-store" } });
}
