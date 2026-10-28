import "server-only";
import { notFound } from "next/navigation";
import { getStudy, type Study } from "@/db/queries";

/** For pages: the study if this workspace owns it, otherwise a 404 (never another workspace's data). */
export async function getStudyOr404(workspaceId: string, studyId: string): Promise<Study> {
  const study = await getStudy(workspaceId, studyId);
  if (!study) {
    notFound();
  }
  return study;
}
