"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { audit } from "@/db/audit";
import { studies, workspaces } from "@/db/schema";
import { getStudy } from "@/db/queries";
import { parseDollarsToCents } from "@/lib/money";
import { rateLimitAction } from "@/lib/rate-limit";
import { clearWorkspaceCookie, ensureWorkspace, requireWorkspace, reviewerName, setReviewerName } from "@/lib/session";
import { createSampleStudy, existingSampleStudy } from "@/studies/sample";
import { createStudy, StudyError, studyInputSchema } from "@/studies/service";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function openSampleStudyAction(): Promise<void> {
  const workspace = await ensureWorkspace();
  const existing = await existingSampleStudy(workspace.id);
  if (existing) {
    redirect(`/studies/${existing}/verify`);
  }
  await rateLimitAction("sample", workspace.id, 10, 3600);
  const studyId = await createSampleStudy(workspace.id);
  revalidatePath("/");
  redirect(`/studies/${studyId}/verify`);
}

export async function createStudyAction(_: FormState, form: FormData): Promise<FormState> {
  const budgetCents = parseDollarsToCents(String(form.get("budget") ?? ""));
  const amountCents = parseDollarsToCents(String(form.get("amount") ?? ""));
  const fieldErrors: Record<string, string> = {};
  if (budgetCents === null || budgetCents <= 0) {
    fieldErrors.budget = "Enter a budget in dollars, e.g. 1500.";
  }
  if (amountCents === null || amountCents <= 0) {
    fieldErrors.amount = "Enter the amount per participant, e.g. 10.";
  }
  const parsed = studyInputSchema.safeParse({
    title: form.get("title"),
    shortCode: form.get("shortCode"),
    protocolNumber: form.get("protocolNumber") || undefined,
    piName: form.get("piName"),
    budgetCents: budgetCents ?? 0,
    amountPerParticipantCents: amountCents ?? 0,
    consentTextExcerpt: form.get("consent"),
    twoReviewerMode: form.get("twoReviewer") === "on",
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (key !== "budgetCents" && key !== "amountPerParticipantCents") {
        fieldErrors[key] ??= issue.message;
      }
    }
  }
  if (!parsed.success || Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }
  const workspace = await ensureWorkspace();
  const actor = (await reviewerName()) ?? parsed.data.piName;
  let studyId: string;
  try {
    const study = await db().transaction((tx) => createStudy(tx, workspace.id, parsed.data, actor));
    studyId = study.id;
  } catch (error) {
    if (error instanceof StudyError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/");
  redirect(`/studies/${studyId}/rules`);
}

export async function setReviewerNameAction(_: FormState, form: FormData): Promise<FormState> {
  const name = String(form.get("reviewerName") ?? "").trim();
  if (name.length < 2 || name.length > 60) {
    return { fieldErrors: { reviewerName: "Enter your name or initials (2–60 characters)." } };
  }
  await ensureWorkspace();
  await setReviewerName(name);
  revalidatePath("/", "layout");
  return {};
}

export async function resetSampleStudyAction(): Promise<void> {
  const workspace = await requireWorkspace();
  const existing = await existingSampleStudy(workspace.id);
  if (existing) {
    const study = await getStudy(workspace.id, existing);
    if (study) {
      await db().delete(studies).where(eq(studies.id, study.id));
      await audit(db(), { workspaceId: workspace.id, actor: (await reviewerName()) ?? "Visitor", action: "sample.reset", target: study.shortCode });
    }
  }
  await rateLimitAction("sample", workspace.id, 10, 3600);
  const studyId = await createSampleStudy(workspace.id);
  revalidatePath("/", "layout");
  redirect(`/studies/${studyId}/verify`);
}

export async function deleteWorkspaceAction(form: FormData): Promise<void> {
  if (form.get("confirm") !== "DELETE") {
    redirect("/workspace?error=confirm");
  }
  const workspace = await requireWorkspace();
  await db().delete(workspaces).where(eq(workspaces.id, workspace.id));
  await clearWorkspaceCookie();
  revalidatePath("/", "layout");
  redirect("/");
}
