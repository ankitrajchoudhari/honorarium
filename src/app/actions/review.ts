"use server";

import { revalidatePath } from "next/cache";
import { getStudy } from "@/db/queries";
import { requireWorkspace, reviewerName } from "@/lib/session";
import { correctIdentity, decide, ReviewError, type ReviewOutcome } from "@/review/service";

export type ReviewActionResult = { ok: true; outcome?: ReviewOutcome } | { ok: false; error: string };

async function context(studyId: string) {
  const workspace = await requireWorkspace();
  const study = await getStudy(workspace.id, studyId);
  const reviewer = await reviewerName();
  if (!study) {
    throw new ReviewError("Study not found.");
  }
  if (!reviewer) {
    throw new ReviewError("Enter your name or initials first; it is recorded on every decision.");
  }
  return { study, reviewer };
}

export async function reviewDecisionAction(studyId: string, ref: string, decision: "pay" | "dont_pay", reason: string): Promise<ReviewActionResult> {
  try {
    const { study, reviewer } = await context(studyId);
    const outcome = await decide(study, ref, decision, reason, reviewer);
    revalidatePath(`/studies/${studyId}`, "layout");
    return { ok: true, outcome };
  } catch (error) {
    if (error instanceof ReviewError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export async function correctIdentityAction(studyId: string, ref: string, value: string, reason: string): Promise<ReviewActionResult> {
  try {
    const { study, reviewer } = await context(studyId);
    await correctIdentity(study, ref, value, reason, reviewer);
    revalidatePath(`/studies/${studyId}`, "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof ReviewError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
