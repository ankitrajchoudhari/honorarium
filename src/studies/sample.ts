import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withStudyLock, db } from "@/db/client";
import { studies } from "@/db/schema";
import { ruleSetSchema } from "@/engine/dsl";
import { importMappingSchema } from "@/import/mapping";
import { importCsv } from "@/import/service";
import { decodeCsvBytes, parseCsvText } from "@/lib/csv";
import { createStudy, lockRules, saveDraftRules } from "@/studies/service";

const SAMPLE_DIR = join(process.cwd(), "data", "sample");
const SAMPLE_CSV = "sleep-study-responses.csv";

const sampleStudySchema = z.object({
  title: z.string(),
  shortCode: z.string(),
  protocolNumber: z.string(),
  piName: z.string(),
  budgetCents: z.int(),
  amountPerParticipantCents: z.int(),
  consentTextExcerpt: z.string(),
  rulesText: z.string(),
});

const sampleRulesSchema = z.object({
  compiledBy: z.string(),
  ruleSet: ruleSetSchema,
  couldNotCompile: z.array(z.object({ phrase: z.string(), reason: z.string() })),
});

async function readJson<T>(name: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(join(SAMPLE_DIR, name), "utf8")));
}

export async function existingSampleStudy(workspaceId: string): Promise<string | null> {
  const [row] = await db()
    .select({ id: studies.id })
    .from(studies)
    .where(and(eq(studies.workspaceId, workspaceId), eq(studies.isSample, true)));
  return row?.id ?? null;
}

/**
 * Creates the synthetic sample study in this workspace with its rules already compiled (by Gemini, saved in
 * data/sample/rules.json) and locked, and its responses imported, so a visitor reaches verification in two clicks.
 */
export async function createSampleStudy(workspaceId: string): Promise<string> {
  const [details, rules, mapping, csv] = await Promise.all([
    readJson("study.json", sampleStudySchema),
    readJson("rules.json", sampleRulesSchema),
    readJson("mapping.json", importMappingSchema),
    readFile(join(SAMPLE_DIR, SAMPLE_CSV)),
  ]);
  const actor = "Sample setup";
  const study = await db().transaction((tx) =>
    createStudy(
      tx,
      workspaceId,
      {
        title: details.title,
        shortCode: details.shortCode,
        protocolNumber: details.protocolNumber,
        piName: details.piName,
        budgetCents: details.budgetCents,
        amountPerParticipantCents: details.amountPerParticipantCents,
        consentTextExcerpt: details.consentTextExcerpt,
        twoReviewerMode: false,
      },
      actor,
      true,
    ),
  );
  await withStudyLock(study.id, async (tx) => {
    await saveDraftRules(tx, study, actor, {
      sourceText: details.rulesText,
      ruleSet: rules.ruleSet,
      couldNotCompile: rules.couldNotCompile,
      compiledBy: rules.compiledBy,
    });
    await lockRules(tx, { ...study, status: "draft" }, actor);
    const [locked] = await tx.select().from(studies).where(eq(studies.id, study.id));
    if (!locked) {
      throw new Error("Sample study vanished during setup.");
    }
    await importCsv(tx, locked, actor, SAMPLE_CSV, new Uint8Array(csv), mapping);
  });
  return study.id;
}

export interface SampleSummary {
  budgetCents: number;
  amountPerParticipantCents: number;
  responses: number;
  botBurst: number;
}

/** Facts about the sample study for the empty home page, read from the sample files rather than written into the UI. */
export async function sampleStudySummary(): Promise<SampleSummary> {
  const [details, manifest, csv] = await Promise.all([
    readJson("study.json", sampleStudySchema),
    readJson("manifest.json", z.record(z.string(), z.array(z.string()))),
    readFile(join(SAMPLE_DIR, SAMPLE_CSV)),
  ]);
  const parsed = parseCsvText(decodeCsvBytes(new Uint8Array(csv)).text);
  return {
    budgetCents: details.budgetCents,
    amountPerParticipantCents: details.amountPerParticipantCents,
    responses: parsed.ok ? parsed.csv.rows.length : 0,
    botBurst: manifest.bot_burst?.length ?? 0,
  };
}
