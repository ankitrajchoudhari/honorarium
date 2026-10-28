import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import type { Transaction } from "@/db/client";
import { audit } from "@/db/audit";
import { ruleSets, studies } from "@/db/schema";
import { touchStudy, type Study } from "@/db/queries";
import { hashCanonical } from "@/engine/canonical";
import { ruleSetSchema, type RuleSet } from "@/engine/dsl";
import { appendLedger } from "@/ledger/ledger";

export const SHORT_CODE = /^[A-Z0-9][A-Z0-9-]{2,15}$/;

export const studyInputSchema = z.object({
  title: z.string().trim().min(3, "Give the study a title.").max(200),
  shortCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(SHORT_CODE, "Use 3–16 capital letters, digits or dashes, e.g. SLEEP-26."),
  protocolNumber: z.string().trim().max(100).optional(),
  piName: z.string().trim().min(2, "Name the principal investigator.").max(200),
  budgetCents: z.int().positive().max(100_000_000, "Budgets above $1,000,000 are not supported."),
  amountPerParticipantCents: z.int().positive().max(1_000_000),
  consentTextExcerpt: z.string().trim().min(10, "Add the consent wording about verification.").max(2_000),
  twoReviewerMode: z.boolean(),
});

export type StudyInput = z.infer<typeof studyInputSchema>;

export class StudyError extends Error {}

export async function createStudy(tx: Transaction, workspaceId: string, input: StudyInput, actor: string, isSample = false): Promise<Study> {
  if (input.amountPerParticipantCents > input.budgetCents) {
    throw new StudyError("The amount per participant is larger than the whole budget.");
  }
  const [existing] = await tx
    .select({ id: studies.id })
    .from(studies)
    .where(and(eq(studies.workspaceId, workspaceId), eq(studies.shortCode, input.shortCode)));
  if (existing) {
    throw new StudyError(`A study with the code ${input.shortCode} already exists in this workspace.`);
  }
  const [study] = await tx
    .insert(studies)
    .values({
      workspaceId,
      title: input.title,
      shortCode: input.shortCode,
      protocolNumber: input.protocolNumber || null,
      piName: input.piName,
      budgetCents: input.budgetCents,
      amountPerParticipantCents: input.amountPerParticipantCents,
      consentTextExcerpt: input.consentTextExcerpt,
      twoReviewerMode: input.twoReviewerMode,
      isSample,
    })
    .returning();
  if (!study) {
    throw new StudyError("The study could not be created.");
  }
  await appendLedger(tx, study.id, [
    { from: "budget", to: "unallocated", amountCents: study.budgetCents, reason: "Study budget set", sourceEvent: "study_created" },
  ]);
  await tx.insert(ruleSets).values({ studyId: study.id, version: 1, sourceText: "" });
  await audit(tx, { workspaceId, studyId: study.id, actor, action: "study.created", target: study.shortCode, after: input });
  return study;
}

async function draftRuleSet(tx: Transaction, studyId: string) {
  const [latest] = await tx.select().from(ruleSets).where(eq(ruleSets.studyId, studyId)).orderBy(desc(ruleSets.version)).limit(1);
  if (!latest) {
    throw new StudyError("This study has no rule set.");
  }
  if (latest.lockedAt) {
    throw new StudyError(`Rules v${latest.version} are locked. Create a new version to change them.`);
  }
  return latest;
}

export async function saveDraftRules(
  tx: Transaction,
  study: Study,
  actor: string,
  draft: { sourceText: string; ruleSet: RuleSet | null; couldNotCompile: { phrase: string; reason: string }[] | null; compiledBy: string | null },
): Promise<void> {
  const latest = await draftRuleSet(tx, study.id);
  const ruleSet = draft.ruleSet ? ruleSetSchema.parse(draft.ruleSet) : null;
  await tx
    .update(ruleSets)
    .set({
      sourceText: draft.sourceText,
      compiledJson: ruleSet,
      couldNotCompileJson: draft.couldNotCompile,
      compiledBy: draft.compiledBy,
    })
    .where(eq(ruleSets.id, latest.id));
  await audit(tx, {
    workspaceId: study.workspaceId,
    studyId: study.id,
    actor,
    action: draft.compiledBy?.startsWith("gemini") ? "rules.compiled" : "rules.edited",
    target: `v${latest.version}`,
    before: latest.compiledJson,
    after: ruleSet,
  });
  await touchStudy(tx, study.id);
}

export async function lockRules(tx: Transaction, study: Study, actor: string): Promise<{ version: number; sha256: string }> {
  const latest = await draftRuleSet(tx, study.id);
  const parsed = ruleSetSchema.safeParse(latest.compiledJson);
  if (!parsed.success || parsed.data.rules.length === 0) {
    throw new StudyError("Compile at least one valid rule before locking.");
  }
  const sha256 = hashCanonical(parsed.data);
  await tx.update(ruleSets).set({ lockedAt: new Date(), lockedBy: actor, sha256 }).where(eq(ruleSets.id, latest.id));
  if (study.status === "draft") {
    await touchStudy(tx, study.id, "rules_locked");
  }
  await audit(tx, { workspaceId: study.workspaceId, studyId: study.id, actor, action: "rules.locked", target: `v${latest.version}`, after: { sha256 } });
  return { version: latest.version, sha256 };
}

/** Starts a new editable version from the latest locked one. The change and its reason appear in the ethics report. */
export async function newRuleVersion(tx: Transaction, study: Study, actor: string, changeNote: string): Promise<number> {
  const [locked] = await tx
    .select()
    .from(ruleSets)
    .where(and(eq(ruleSets.studyId, study.id), isNotNull(ruleSets.lockedAt)))
    .orderBy(desc(ruleSets.version))
    .limit(1);
  const [latest] = await tx.select().from(ruleSets).where(eq(ruleSets.studyId, study.id)).orderBy(desc(ruleSets.version)).limit(1);
  if (!locked || !latest || !latest.lockedAt) {
    throw new StudyError("There is already an unlocked version to edit.");
  }
  const version = latest.version + 1;
  await tx.insert(ruleSets).values({
    studyId: study.id,
    version,
    sourceText: locked.sourceText,
    compiledJson: locked.compiledJson,
    couldNotCompileJson: locked.couldNotCompileJson,
    compiledBy: locked.compiledBy,
    changeNote,
  });
  await audit(tx, { workspaceId: study.workspaceId, studyId: study.id, actor, action: "rules.new_version", target: `v${version}`, after: { changeNote } });
  return version;
}
