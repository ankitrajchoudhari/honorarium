import "server-only";
import { and, asc, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, type Executor } from "@/db/client";
import { imports, questionMap, respondents, ruleSets, studies } from "@/db/schema";
import { ruleSetSchema, type RuleSet } from "@/engine/dsl";

export type Study = typeof studies.$inferSelect;
export type RuleSetRow = typeof ruleSets.$inferSelect;

/** Every study read goes through here: a study is only visible inside the workspace that owns it. */
export async function getStudy(workspaceId: string, studyId: string, executor: Executor = db()): Promise<Study | null> {
  if (!/^[0-9a-f-]{36}$/.test(studyId)) {
    return null;
  }
  const [row] = await executor
    .select()
    .from(studies)
    .where(and(eq(studies.id, studyId), eq(studies.workspaceId, workspaceId)));
  return row ?? null;
}

export interface StudySummary {
  study: Study;
  respondents: number;
  pay: number;
  hold: number;
  dontPay: number;
}

export async function listStudies(workspaceId: string): Promise<StudySummary[]> {
  const rows = await db().select().from(studies).where(eq(studies.workspaceId, workspaceId)).orderBy(desc(studies.updatedAt));
  if (rows.length === 0) {
    return [];
  }
  const counts = await db()
    .select({ studyId: respondents.studyId, decision: respondents.currentDecision, total: count() })
    .from(respondents)
    .innerJoin(studies, eq(studies.id, respondents.studyId))
    .where(eq(studies.workspaceId, workspaceId))
    .groupBy(respondents.studyId, respondents.currentDecision);
  return rows.map((study) => {
    const own = counts.filter((row) => row.studyId === study.id);
    const of = (decision: string | null) => own.filter((row) => row.decision === decision).reduce((sum, row) => sum + row.total, 0);
    return {
      study,
      respondents: own.reduce((sum, row) => sum + row.total, 0),
      pay: of("pay"),
      hold: of("hold"),
      dontPay: of("dont_pay"),
    };
  });
}

export async function ruleSetVersions(studyId: string, executor: Executor = db()): Promise<RuleSetRow[]> {
  return executor.select().from(ruleSets).where(eq(ruleSets.studyId, studyId)).orderBy(desc(ruleSets.version));
}

export async function lockedRuleSet(studyId: string, executor: Executor = db()): Promise<{ row: RuleSetRow; rules: RuleSet } | null> {
  const [row] = await executor
    .select()
    .from(ruleSets)
    .where(and(eq(ruleSets.studyId, studyId), isNotNull(ruleSets.lockedAt)))
    .orderBy(desc(ruleSets.version))
    .limit(1);
  if (!row) {
    return null;
  }
  return { row, rules: ruleSetSchema.parse(row.compiledJson) };
}

export async function studyImport(studyId: string, executor: Executor = db()) {
  const [row] = await executor.select().from(imports).where(eq(imports.studyId, studyId));
  return row ?? null;
}

export async function studyQuestionMap(studyId: string, executor: Executor = db()) {
  return executor.select().from(questionMap).where(eq(questionMap.studyId, studyId)).orderBy(asc(questionMap.position));
}

export async function decisionCounts(studyId: string, executor: Executor = db()): Promise<{ pay: number; hold: number; dontPay: number; undecided: number; total: number }> {
  const rows = await executor
    .select({ decision: respondents.currentDecision, total: count() })
    .from(respondents)
    .where(eq(respondents.studyId, studyId))
    .groupBy(respondents.currentDecision);
  const of = (decision: string | null) => rows.find((row) => row.decision === decision)?.total ?? 0;
  return { pay: of("pay"), hold: of("hold"), dontPay: of("dont_pay"), undecided: of(null), total: rows.reduce((sum, row) => sum + row.total, 0) };
}

export async function touchStudy(executor: Executor, studyId: string, status?: Study["status"]): Promise<void> {
  await executor
    .update(studies)
    .set(status ? { status, updatedAt: new Date() } : { updatedAt: sql`now()` })
    .where(eq(studies.id, studyId));
}
