import { NextResponse } from "next/server";
import { stepJob } from "@/jobs/verify";
import { currentWorkspace } from "@/lib/session";

export const maxDuration = 60;

export async function POST(_: Request, context: RouteContext<"/api/jobs/[jobId]/step">) {
  const { jobId } = await context.params;
  const workspace = await currentWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: "No workspace." }, { status: 401 });
  }
  const state = await stepJob(workspace.id, jobId);
  if (!state) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  return NextResponse.json(state);
}
