"use server";

import { revalidatePath } from "next/cache";
import { getStudy, studyImport } from "@/db/queries";
import { finishWithoutAi, jobState, resumeJob, startVerification, type JobState } from "@/jobs/verify";
import { rateLimitAction, RateLimitError } from "@/lib/rate-limit";
import { requireWorkspace } from "@/lib/session";

export type StartResult = { ok: true; state: JobState } | { ok: false; error: string };

export async function startVerificationAction(studyId: string): Promise<StartResult> {
  const workspace = await requireWorkspace();
  const study = await getStudy(workspace.id, studyId);
  if (!study) {
    return { ok: false, error: "Study not found." };
  }
  if (!(await studyImport(study.id))) {
    return { ok: false, error: "Import responses before verifying." };
  }
  try {
    await rateLimitAction("verify", workspace.id, 30, 3600);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
  const jobId = await startVerification(study);
  const state = await jobState(workspace.id, jobId);
  return state ? { ok: true, state } : { ok: false, error: "The job could not be read back." };
}

export async function resumeJobAction(jobId: string): Promise<JobState | null> {
  const workspace = await requireWorkspace();
  await resumeJob(workspace.id, jobId);
  return jobState(workspace.id, jobId);
}

export async function finishWithoutAiAction(studyId: string, jobId: string): Promise<JobState | null> {
  const workspace = await requireWorkspace();
  await finishWithoutAi(workspace.id, jobId);
  revalidatePath(`/studies/${studyId}/verify`);
  return jobState(workspace.id, jobId);
}
