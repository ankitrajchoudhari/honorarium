import { NextResponse } from "next/server";
import { getStudy } from "@/db/queries";
import { currentWorkspace } from "@/lib/session";
import { respondentDetail } from "@/respondents/detail";

export async function GET(_: Request, context: RouteContext<"/api/studies/[studyId]/respondents/[ref]">) {
  const { studyId, ref } = await context.params;
  const workspace = await currentWorkspace();
  const study = workspace ? await getStudy(workspace.id, studyId) : null;
  if (!study) {
    return NextResponse.json({ error: "Study not found." }, { status: 404 });
  }
  const detail = await respondentDetail(study, decodeURIComponent(ref));
  if (!detail) {
    return NextResponse.json({ error: "Respondent not found." }, { status: 404 });
  }
  return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
}
