import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AI_BATCH_SIZE,
  ASSESS_PROMPT_VERSION,
  ASSESS_SYSTEM_INSTRUCTION,
  ASSESSMENT_JSON_SCHEMA,
  assessmentOutputSchema,
  notAssessedCheck,
  toAiCheck,
  validateResultRefs,
} from "@/ai/assessment";
import { callStructured, MIN_CALL_SPACING_MS } from "@/ai/gemini";
import { assertNoIdentifiers, buildAssessmentPayload } from "@/ai/payload";
import { db, withStudyLock, type Executor, type Transaction } from "@/db/client";
import { checks, decisions, jobs, respondents, studies } from "@/db/schema";
import { lockedRuleSet, studyImport, studyQuestionMap, touchStudy, type Study } from "@/db/queries";
import { combine, type Reason } from "@/engine/combine";
import { IDENTIFYING_ROLES, type ColumnRole } from "@/engine/roles";
import type { RuleSet } from "@/engine/dsl";
import { evaluateRuleSet } from "@/engine/rules";
import { findClusters, similarityChecks } from "@/engine/similarity";
import type { Check, EngineRespondent, RoleColumns } from "@/engine/types";
import { syncReservations } from "@/ledger/ledger";

const RULE_CHUNK = 400;
const LEASE_SECONDS = 90;
const MAX_TRANSIENT_ATTEMPTS = 5;

const phaseSchema = z.enum(["rules", "similarity", "ai", "decide", "done"]);
export type Phase = z.infer<typeof phaseSchema>;

const cursorSchema = z.object({
  phase: phaseSchema,
  offset: z.int(),
  ruleSetVersion: z.int(),
  aiTotal: z.int(),
  aiDone: z.int(),
  aiNotRun: z.int(),
  paused: z.object({ kind: z.string(), message: z.string() }).nullable(),
});
type Cursor = z.infer<typeof cursorSchema>;
type JobRow = typeof jobs.$inferSelect;

export interface JobState {
  jobId: string;
  status: JobRow["status"];
  phase: Phase;
  respondents: number;
  rulesDone: number;
  aiTotal: number;
  aiDone: number;
  aiNotRun: number;
  paused: Cursor["paused"];
  lastError: string | null;
  waitMs: number;
}

interface Loaded {
  study: Study;
  ruleSetVersion: number;
  rules: RuleSet;
  people: (EngineRespondent & { id: string })[];
  roleColumns: RoleColumns;
  dateOrder: "MDY" | "DMY";
  openText: { column: string; question: string; context: { column: string; label: string }[] }[];
  identifyingColumns: string[];
}

async function load(study: Study, executor: Executor = db()): Promise<Loaded> {
  const [locked, imported, map] = await Promise.all([lockedRuleSet(study.id, executor), studyImport(study.id, executor), studyQuestionMap(study.id, executor)]);
  if (!locked || !imported) {
    throw new Error("Lock rules and import responses before verifying.");
  }
  const rows = await executor
    .select()
    .from(respondents)
    .where(eq(respondents.studyId, study.id))
    .orderBy(respondents.rowNumber);
  const roleColumns: RoleColumns = {};
  for (const entry of map) {
    (roleColumns[entry.role as ColumnRole] ??= []).push(entry.columnName);
  }
  const labelOf = (column: string) => map.find((entry) => entry.columnName === column)?.questionText ?? column;
  return {
    study,
    ruleSetVersion: locked.row.version,
    rules: locked.rules,
    people: rows.map((row) => ({
      id: row.id,
      ref: row.respondentRef,
      rowNumber: row.rowNumber,
      values: row.rawJson,
      submittedAt: row.submittedAt,
      durationSeconds: row.durationSeconds,
      payout:
        row.payoutIdentityType && row.payoutIdentityRaw !== null
          ? { type: row.payoutIdentityType, raw: row.payoutIdentityRaw, normalized: row.payoutIdentityNormalized }
          : null,
    })),
    roleColumns,
    dateOrder: imported.dateOrder === "DMY" ? "DMY" : "MDY",
    openText: map
      .filter((entry) => entry.role === "open_text")
      .map((entry) => ({
        column: entry.columnName,
        question: entry.questionText ?? entry.columnName,
        context: entry.contextColumns.map((column) => ({ column, label: labelOf(column) })),
      })),
    identifyingColumns: map.filter((entry) => IDENTIFYING_ROLES.has(entry.role as ColumnRole)).map((entry) => entry.columnName),
  };
}

async function upsertChecks(tx: Executor, studyId: string, version: number, entries: { respondentId: string; check: Check }[]): Promise<void> {
  for (let start = 0; start < entries.length; start += 300) {
    await tx
      .insert(checks)
      .values(
        entries.slice(start, start + 300).map(({ respondentId, check }) => ({
          studyId,
          respondentId,
          ruleId: check.ruleId,
          layer: check.layer,
          source: check.source,
          outcome: check.outcome,
          evidenceJson: check.evidence,
          ruleSetVersion: version,
        })),
      )
      .onConflictDoUpdate({
        target: [checks.respondentId, checks.ruleId],
        set: {
          layer: sql`excluded.layer`,
          source: sql`excluded.source`,
          outcome: sql`excluded.outcome`,
          evidenceJson: sql`excluded.evidence_json`,
          ruleSetVersion: sql`excluded.rule_set_version`,
          updatedAt: sql`now()`,
        },
      });
  }
}

interface PendingAi {
  respondentId: string;
  ref: string;
  column: string;
  answer: string;
}

/** `runStartedAt`: placeholders written by this run count as done; older ones are retried. */
async function pendingAiItems(loaded: Loaded, runStartedAt: Date): Promise<PendingAi[]> {
  const existing = await db()
    .select({
      respondentId: checks.respondentId,
      ruleId: checks.ruleId,
      layer: checks.layer,
      source: checks.source,
      retry: sql<boolean>`coalesce(${checks.evidenceJson} -> 'values' ->> 'status' = 'not_run', false) and ${checks.updatedAt} < ${runStartedAt.toISOString()}::timestamptz`,
    })
    .from(checks)
    .where(and(eq(checks.studyId, loaded.study.id), or(eq(checks.layer, "ai"), and(eq(checks.source, "rule"), eq(checks.outcome, "exclude")))));
  const excluded = new Set(existing.filter((row) => row.source === "rule").map((row) => row.respondentId));
  // "AI review not run" placeholders from an earlier run are retried (e.g. after the daily cap resets).
  const assessed = new Set(existing.filter((row) => row.layer === "ai" && !row.retry).map((row) => `${row.respondentId}|${row.ruleId}`));
  const pending: PendingAi[] = [];
  for (const question of loaded.openText) {
    for (const person of loaded.people) {
      const answer = (person.values[question.column] ?? "").trim();
      if (answer.length === 0 || excluded.has(person.id) || assessed.has(`${person.id}|ai:${question.column}`)) {
        continue;
      }
      pending.push({ respondentId: person.id, ref: person.ref, column: question.column, answer });
    }
  }
  return pending;
}

function freshCursor(ruleSetVersion: number): Cursor {
  return { phase: "rules", offset: 0, ruleSetVersion, aiTotal: 0, aiDone: 0, aiNotRun: 0, paused: null };
}

/** Starts verification for the locked rules, or returns the job already in progress. */
export async function startVerification(study: Study): Promise<string> {
  const locked = await lockedRuleSet(study.id);
  if (!locked) {
    throw new Error("Lock the rules first.");
  }
  const [active] = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.studyId, study.id), inArray(jobs.status, ["running", "paused"])));
  if (active) {
    return active.id;
  }
  const [created] = await db().insert(jobs).values({ studyId: study.id, kind: "verify", cursorJson: freshCursor(locked.row.version) }).returning({ id: jobs.id });
  if (!created) {
    throw new Error("Could not start verification.");
  }
  await touchStudy(db(), study.id, "verifying");
  return created.id;
}

export async function latestJob(studyId: string): Promise<JobRow | null> {
  const [row] = await db().select().from(jobs).where(eq(jobs.studyId, studyId)).orderBy(sql`${jobs.createdAt} desc`).limit(1);
  return row ?? null;
}

async function jobForWorkspace(workspaceId: string, jobId: string): Promise<{ job: JobRow; study: Study } | null> {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) {
    return null;
  }
  const [row] = await db()
    .select({ job: jobs, study: studies })
    .from(jobs)
    .innerJoin(studies, eq(studies.id, jobs.studyId))
    .where(and(eq(jobs.id, jobId), eq(studies.workspaceId, workspaceId)));
  return row ?? null;
}

async function stateOf(job: JobRow, waitMs = 0): Promise<JobState> {
  const cursor = cursorSchema.parse(job.cursorJson);
  const [{ total } = { total: 0 }] = await db().select({ total: sql<number>`count(*)::int` }).from(respondents).where(eq(respondents.studyId, job.studyId));
  return {
    jobId: job.id,
    status: job.status,
    phase: cursor.phase,
    respondents: total,
    rulesDone: cursor.phase === "rules" ? Math.min(cursor.offset, total) : total,
    aiTotal: cursor.aiTotal,
    aiDone: cursor.aiDone,
    aiNotRun: cursor.aiNotRun,
    paused: cursor.paused,
    lastError: job.lastError,
    waitMs,
  };
}

export async function jobState(workspaceId: string, jobId: string): Promise<JobState | null> {
  const found = await jobForWorkspace(workspaceId, jobId);
  return found ? stateOf(found.job) : null;
}

type StepOutcome = { cursor: Cursor; status?: JobRow["status"]; waitMs: number; attempts?: number; notBeforeMs?: number };

async function runRules(loaded: Loaded, cursor: Cursor): Promise<StepOutcome> {
  if (cursor.offset === 0) {
    await db().delete(checks).where(and(eq(checks.studyId, loaded.study.id), eq(checks.layer, "deterministic")));
  }
  const all = evaluateRuleSet(loaded.rules, loaded.people, { roleColumns: loaded.roleColumns, dateOrder: loaded.dateOrder });
  const slice = loaded.people.slice(cursor.offset, cursor.offset + RULE_CHUNK);
  await upsertChecks(
    db(),
    loaded.study.id,
    loaded.ruleSetVersion,
    slice.flatMap((person) => (all.get(person.ref) ?? []).map((check) => ({ respondentId: person.id, check }))),
  );
  const offset = cursor.offset + slice.length;
  return { cursor: offset >= loaded.people.length ? { ...cursor, phase: "similarity", offset: 0 } : { ...cursor, offset }, waitMs: 0 };
}

async function runSimilarity(loaded: Loaded, cursor: Cursor, runStartedAt: Date): Promise<StepOutcome> {
  await db().delete(checks).where(and(eq(checks.studyId, loaded.study.id), eq(checks.layer, "similarity")));
  const idOf = new Map(loaded.people.map((person) => [person.ref, person.id]));
  const entries: { respondentId: string; check: Check }[] = [];
  for (const question of loaded.openText) {
    const clusters = findClusters(loaded.people.map((person) => ({ ref: person.ref, text: person.values[question.column] ?? "" })));
    for (const [ref, check] of similarityChecks(question.column, clusters)) {
      const respondentId = idOf.get(ref);
      if (respondentId) {
        entries.push({ respondentId, check });
      }
    }
  }
  await upsertChecks(db(), loaded.study.id, loaded.ruleSetVersion, entries);
  const pending = await pendingAiItems(loaded, runStartedAt);
  return { cursor: { ...cursor, phase: "ai", offset: 0, aiTotal: pending.length, aiDone: 0 }, waitMs: 0 };
}

function backoffMs(attempts: number): number {
  return Math.min(60_000, 2 ** attempts * 2_000) + Math.floor(Math.random() * 1_000);
}

async function markNotRun(loaded: Loaded, items: PendingAi[], reason: string): Promise<void> {
  await upsertChecks(
    db(),
    loaded.study.id,
    loaded.ruleSetVersion,
    items.map((item) => ({ respondentId: item.respondentId, check: notAssessedCheck(item.column, reason) })),
  );
}

async function runAi(loaded: Loaded, cursor: Cursor, attempts: number, runStartedAt: Date): Promise<StepOutcome> {
  const pending = await pendingAiItems(loaded, runStartedAt);
  const first = pending[0];
  if (!first) {
    return { cursor: { ...cursor, phase: "decide" }, waitMs: 0 };
  }
  const batch = pending.filter((item) => item.column === first.column).slice(0, AI_BATCH_SIZE);
  const question = loaded.openText.find((entry) => entry.column === first.column);
  if (!question) {
    throw new Error(`Open-text column ${first.column} is no longer mapped.`);
  }
  const people = new Map(loaded.people.map((person) => [person.id, person]));
  const payload = buildAssessmentPayload(
    question.question,
    batch.map((item) => ({
      respondentRef: item.ref,
      answer: item.answer,
      closedAnswers: Object.fromEntries(question.context.map((context) => [context.label, people.get(item.respondentId)?.values[context.column] ?? ""])),
    })),
  );
  const identifiers = batch.flatMap((item) => {
    const person = people.get(item.respondentId);
    return [person?.payout?.raw ?? "", person?.payout?.normalized ?? "", ...loaded.identifyingColumns.map((column) => person?.values[column] ?? "")];
  });
  assertNoIdentifiers(payload, identifiers);

  const refs = batch.map((item) => item.ref);
  const result = await callStructured({
    promptVersion: ASSESS_PROMPT_VERSION,
    systemInstruction: ASSESS_SYSTEM_INSTRUCTION,
    payload,
    schema: assessmentOutputSchema,
    jsonSchema: ASSESSMENT_JSON_SCHEMA,
    validate: (data) => validateResultRefs(data.results, refs),
  });

  if (result.ok) {
    const byRef = new Map(result.data.results.map((entry) => [entry.respondent_ref, entry]));
    await upsertChecks(
      db(),
      loaded.study.id,
      loaded.ruleSetVersion,
      batch.map((item) => ({ respondentId: item.respondentId, check: toAiCheck(item.column, item.answer, byRef.get(item.ref)!) })),
    );
    return { cursor: { ...cursor, aiDone: cursor.aiDone + batch.length }, waitMs: result.cached ? 0 : MIN_CALL_SPACING_MS, attempts: 0 };
  }
  switch (result.kind) {
    case "too_soon":
      return { cursor, waitMs: result.retryAfterMs };
    case "cap_reached":
      return { cursor: { ...cursor, paused: { kind: "cap_reached", message: result.message } }, status: "paused", waitMs: 0 };
    case "rate_limited":
    case "unavailable": {
      if (attempts + 1 >= MAX_TRANSIENT_ATTEMPTS) {
        return { cursor: { ...cursor, paused: { kind: result.kind, message: `${result.message} Tried ${attempts + 1} times.` } }, status: "paused", waitMs: 0, attempts: 0 };
      }
      const delay = backoffMs(attempts + 1);
      return { cursor, waitMs: delay, attempts: attempts + 1, notBeforeMs: delay };
    }
    case "invalid_output":
    case "failed":
      await markNotRun(loaded, batch, result.message);
      return { cursor: { ...cursor, aiDone: cursor.aiDone + batch.length, aiNotRun: cursor.aiNotRun + batch.length }, waitMs: MIN_CALL_SPACING_MS, attempts: 0 };
  }
}

/** Applies the decision model to every respondent. Human (reviewer/payout) decisions are never overwritten. */
export async function applyDecisions(tx: Transaction, studyId: string): Promise<void> {
  const people = await tx
    .select({ id: respondents.id, current: respondents.currentDecision, source: respondents.currentDecisionSource })
    .from(respondents)
    .where(eq(respondents.studyId, studyId));
  const rows = await tx.select().from(checks).where(eq(checks.studyId, studyId));
  const byRespondent = new Map<string, Check[]>();
  for (const row of rows) {
    const check = { layer: row.layer, source: row.source, ruleId: row.ruleId, outcome: row.outcome, evidence: row.evidenceJson } as Check;
    const list = byRespondent.get(row.respondentId);
    if (list) {
      list.push(check);
    } else {
      byRespondent.set(row.respondentId, [check]);
    }
  }
  const lastReasons = await tx
    .selectDistinctOn([decisions.respondentId], { respondentId: decisions.respondentId, reasons: decisions.reasonsJson })
    .from(decisions)
    .where(eq(decisions.studyId, studyId))
    .orderBy(decisions.respondentId, sql`${decisions.decidedAt} desc`);
  const previous = new Map(lastReasons.map((row) => [row.respondentId, JSON.stringify(row.reasons)]));

  const changes: { id: string; decision: "pay" | "hold" | "dont_pay"; reasons: Reason[] }[] = [];
  for (const person of people) {
    if (person.source === "reviewer" || person.source === "payout") {
      continue;
    }
    const combined = combine(byRespondent.get(person.id) ?? []);
    if (person.current !== combined.decision || previous.get(person.id) !== JSON.stringify(combined.reasons)) {
      changes.push({ id: person.id, decision: combined.decision, reasons: combined.reasons });
    }
  }
  for (let start = 0; start < changes.length; start += 300) {
    const slice = changes.slice(start, start + 300);
    await tx.insert(decisions).values(
      slice.map((change) => ({ studyId, respondentId: change.id, decision: change.decision, source: "rules" as const, reasonsJson: change.reasons, decidedBy: "Rules" })),
    );
    for (const decision of ["pay", "hold", "dont_pay"] as const) {
      const ids = slice.filter((change) => change.decision === decision).map((change) => change.id);
      if (ids.length > 0) {
        await tx.update(respondents).set({ currentDecision: decision, currentDecisionSource: "rules" }).where(inArray(respondents.id, ids));
      }
    }
  }
}

async function runDecide(loaded: Loaded, cursor: Cursor): Promise<StepOutcome> {
  await withStudyLock(loaded.study.id, async (tx) => {
    await applyDecisions(tx, loaded.study.id);
    await syncReservations(tx, loaded.study.id, "verification");
    await touchStudy(tx, loaded.study.id, "reviewing");
  });
  return { cursor: { ...cursor, phase: "done" }, status: "done", waitMs: 0 };
}

/** Processes one chunk of work. Safe to call from several tabs: only the holder of the lease does work. */
export async function stepJob(workspaceId: string, jobId: string): Promise<JobState | null> {
  const found = await jobForWorkspace(workspaceId, jobId);
  if (!found) {
    return null;
  }
  const { job, study } = found;
  if (job.status !== "running") {
    return stateOf(job);
  }
  if (job.notBefore && job.notBefore.getTime() > Date.now()) {
    return stateOf(job, job.notBefore.getTime() - Date.now());
  }
  const [claimed] = await db()
    .update(jobs)
    .set({ version: sql`${jobs.version} + 1`, leaseUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})` })
    .where(and(eq(jobs.id, job.id), eq(jobs.version, job.version), eq(jobs.status, "running"), or(isNull(jobs.leaseUntil), lt(jobs.leaseUntil, sql`now()`))))
    .returning();
  if (!claimed) {
    return stateOf(job, 1_000);
  }

  const cursor = cursorSchema.parse(claimed.cursorJson);
  let outcome: StepOutcome;
  try {
    const loaded = await load(study);
    if (loaded.ruleSetVersion !== cursor.ruleSetVersion) {
      outcome = { cursor: freshCursor(loaded.ruleSetVersion), waitMs: 0 };
    } else if (cursor.phase === "rules") {
      outcome = await runRules(loaded, cursor);
    } else if (cursor.phase === "similarity") {
      outcome = await runSimilarity(loaded, cursor, claimed.createdAt);
    } else if (cursor.phase === "ai") {
      outcome = await runAi(loaded, cursor, claimed.attempts, claimed.createdAt);
    } else if (cursor.phase === "decide") {
      outcome = await runDecide(loaded, cursor);
    } else {
      outcome = { cursor, status: "done", waitMs: 0 };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    const attempts = claimed.attempts + 1;
    const [released] = await db()
      .update(jobs)
      .set({ leaseUntil: null, attempts, lastError: message, status: attempts >= 3 ? "failed" : "running", version: sql`${jobs.version} + 1` })
      .where(and(eq(jobs.id, job.id), eq(jobs.version, claimed.version)))
      .returning();
    return stateOf(released ?? claimed, 2_000);
  }

  const [saved] = await db()
    .update(jobs)
    .set({
      cursorJson: outcome.cursor,
      status: outcome.status ?? "running",
      leaseUntil: null,
      attempts: outcome.attempts ?? claimed.attempts,
      notBefore: outcome.notBeforeMs ? new Date(Date.now() + outcome.notBeforeMs) : null,
      lastError: null,
      version: sql`${jobs.version} + 1`,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.version, claimed.version)))
    .returning();
  return stateOf(saved ?? claimed, outcome.waitMs);
}

export async function resumeJob(workspaceId: string, jobId: string): Promise<void> {
  const found = await jobForWorkspace(workspaceId, jobId);
  if (!found || found.job.status !== "paused") {
    return;
  }
  const cursor = cursorSchema.parse(found.job.cursorJson);
  await db()
    .update(jobs)
    .set({ status: "running", attempts: 0, notBefore: null, cursorJson: { ...cursor, paused: null }, version: sql`${jobs.version} + 1` })
    .where(eq(jobs.id, jobId));
}

/** When AI review cannot continue: remaining answers are marked "AI review not run" (held), then decisions are made. */
export async function finishWithoutAi(workspaceId: string, jobId: string): Promise<void> {
  const found = await jobForWorkspace(workspaceId, jobId);
  if (!found || found.job.status !== "paused") {
    return;
  }
  const loaded = await load(found.study);
  const pending = await pendingAiItems(loaded, found.job.createdAt);
  const cursor = cursorSchema.parse(found.job.cursorJson);
  await markNotRun(loaded, pending, cursor.paused?.kind ?? "stopped");
  await db()
    .update(jobs)
    .set({
      status: "running",
      attempts: 0,
      notBefore: null,
      cursorJson: { ...cursor, phase: "decide", paused: null, aiDone: cursor.aiDone + pending.length, aiNotRun: cursor.aiNotRun + pending.length },
      version: sql`${jobs.version} + 1`,
    })
    .where(eq(jobs.id, jobId));
}
