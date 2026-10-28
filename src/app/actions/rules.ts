"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { compileRules } from "@/ai/compile-rules";
import { aiModel } from "@/ai/gemini";
import { withStudyLock } from "@/db/client";
import { getStudy } from "@/db/queries";
import { ruleSetSchema, type RuleSet } from "@/engine/dsl";
import { rateLimitAction, RateLimitError } from "@/lib/rate-limit";
import { requireWorkspace, reviewerName } from "@/lib/session";
import { lockRules, newRuleVersion, saveDraftRules, StudyError } from "@/studies/service";

export type RulesActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function context(studyId: string) {
  const workspace = await requireWorkspace();
  const study = await getStudy(workspace.id, studyId);
  if (!study) {
    throw new StudyError("Study not found.");
  }
  const actor = (await reviewerName()) ?? study.piName;
  return { workspace, study, actor };
}

function failure(error: unknown): RulesActionResult {
  if (error instanceof StudyError || error instanceof RateLimitError) {
    return { ok: false, error: error.message };
  }
  throw error;
}

export async function compileRulesAction(studyId: string, sourceText: string): Promise<RulesActionResult> {
  try {
    const text = z.string().trim().min(10, "Write at least one rule.").max(5_000, "Keep the rules under 5,000 characters.").parse(sourceText);
    const { workspace, study, actor } = await context(studyId);
    await rateLimitAction("compile", workspace.id, 20, 3600);
    const result = await compileRules(text);
    if (!result.ok) {
      return { ok: false, error: result.kind === "too_soon" ? "Gemini is busy with another request. Try again in a few seconds." : result.message };
    }
    await withStudyLock(study.id, (tx) =>
      saveDraftRules(tx, study, actor, { sourceText: text, ruleSet: result.data.ruleSet, couldNotCompile: result.data.couldNotCompile, compiledBy: `gemini:${aiModel()}` }),
    );
    revalidatePath(`/studies/${studyId}/rules`);
    return { ok: true, message: `Compiled ${result.data.ruleSet.rules.length} rules.` };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Invalid rules text." };
    }
    return failure(error);
  }
}

export async function saveRulesAction(studyId: string, sourceText: string, ruleSet: RuleSet): Promise<RulesActionResult> {
  try {
    if (sourceText.length > 5_000) {
      return { ok: false, error: "Keep the rules under 5,000 characters." };
    }
    const parsed = ruleSetSchema.safeParse(ruleSet);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join(" ") };
    }
    const { study, actor } = await context(studyId);
    await withStudyLock(study.id, async (tx) => {
      const current = (await tx.query.ruleSets.findFirst({ where: (table, { eq }) => eq(table.studyId, study.id), orderBy: (table, { desc }) => desc(table.version) })) ?? null;
      await saveDraftRules(tx, study, actor, {
        sourceText,
        ruleSet: parsed.data,
        couldNotCompile: (current?.couldNotCompileJson as { phrase: string; reason: string }[] | null) ?? null,
        compiledBy: current?.compiledBy ? `${current.compiledBy.replace(/ \+ edited$/, "")} + edited` : "manual",
      });
    });
    revalidatePath(`/studies/${studyId}/rules`);
    return { ok: true, message: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function lockRulesAction(studyId: string, confirmed: boolean): Promise<RulesActionResult> {
  try {
    if (!confirmed) {
      return { ok: false, error: "Confirm that these rules were decided before looking at the responses." };
    }
    const { study, actor } = await context(studyId);
    const locked = await withStudyLock(study.id, (tx) => lockRules(tx, study, actor));
    revalidatePath(`/studies/${studyId}`, "layout");
    return { ok: true, message: `Rules v${locked.version} locked · ${locked.sha256.slice(0, 12)}` };
  } catch (error) {
    return failure(error);
  }
}

export async function newRuleVersionAction(studyId: string, changeNote: string): Promise<RulesActionResult> {
  try {
    const note = changeNote.trim();
    if (note.length < 10) {
      return { ok: false, error: "Explain why the rules are changing (at least 10 characters). This appears in the ethics report." };
    }
    const { study, actor } = await context(studyId);
    const version = await withStudyLock(study.id, (tx) => newRuleVersion(tx, study, actor, note));
    revalidatePath(`/studies/${studyId}`, "layout");
    return { ok: true, message: `Version ${version} created. Edit and lock it to apply.` };
  } catch (error) {
    return failure(error);
  }
}
