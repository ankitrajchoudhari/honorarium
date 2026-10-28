import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Executor, Transaction } from "@/db/client";
import { ledgerEntries, payoutItems, RELEASED_ITEM_STATUSES, respondents, studies } from "@/db/schema";
import { BUCKETS, checkInvariant, emptyBalances, type Balances, type InvariantResult, type LedgerBucket } from "@/ledger/buckets";
import { planReservations, type ReservationBucket, type ReservationState } from "@/ledger/reservations";

export interface LedgerWrite {
  respondentId?: string | null;
  payoutItemId?: string | null;
  from: LedgerBucket;
  to: LedgerBucket;
  amountCents: number;
  reason: string;
  sourceEvent: string;
}

export class LedgerOutOfBalanceError extends Error {
  constructor(public readonly result: Extract<InvariantResult, { balanced: false }>) {
    super(`Ledger out of balance by ${result.difference} cents${result.negative.length ? `; negative: ${result.negative.join(", ")}` : ""}.`);
    this.name = "LedgerOutOfBalanceError";
  }
}

export async function getBalances(executor: Executor, studyId: string): Promise<Balances> {
  const rows = await executor
    .select({
      bucket: sql<string>`b.bucket`,
      amount: sql<string>`sum(b.amount)`,
    })
    .from(
      sql`(
        select to_bucket as bucket, amount_cents as amount from ${ledgerEntries} where study_id = ${studyId}
        union all
        select from_bucket as bucket, -amount_cents as amount from ${ledgerEntries} where study_id = ${studyId}
      ) as b`,
    )
    .groupBy(sql`b.bucket`);
  const balances = emptyBalances();
  for (const row of rows) {
    if ((BUCKETS as readonly string[]).includes(row.bucket)) {
      balances[row.bucket as keyof Balances] = Number(row.amount);
    }
  }
  return balances;
}

export async function ledgerStatus(executor: Executor, studyId: string, budgetCents: number): Promise<{ balances: Balances; invariant: InvariantResult }> {
  const balances = await getBalances(executor, studyId);
  return { balances, invariant: checkInvariant(budgetCents, balances) };
}

/**
 * Appends entries, then re-checks the invariant inside the same transaction.
 * If the books would not balance, the whole transaction is rolled back: nothing is auto-corrected.
 */
export async function appendLedger(tx: Transaction, studyId: string, writes: readonly LedgerWrite[]): Promise<void> {
  if (writes.length > 0) {
    for (const write of writes) {
      if (!Number.isSafeInteger(write.amountCents) || write.amountCents <= 0 || write.from === write.to) {
        throw new Error(`Invalid ledger write: ${write.from} → ${write.to} ${write.amountCents}`);
      }
    }
    for (let start = 0; start < writes.length; start += 500) {
      await tx.insert(ledgerEntries).values(
        writes.slice(start, start + 500).map((write) => ({
          studyId,
          respondentId: write.respondentId ?? null,
          payoutItemId: write.payoutItemId ?? null,
          fromBucket: write.from,
          toBucket: write.to,
          amountCents: write.amountCents,
          reason: write.reason,
          sourceEvent: write.sourceEvent,
        })),
      );
    }
  }
  const [study] = await tx.select({ budgetCents: studies.budgetCents }).from(studies).where(eq(studies.id, studyId));
  if (!study) {
    throw new Error("Study not found for ledger write.");
  }
  const result = checkInvariant(study.budgetCents, await getBalances(tx, studyId));
  if (!result.balanced) {
    throw new LedgerOutOfBalanceError(result);
  }
}

async function reservedBuckets(tx: Transaction, studyId: string): Promise<Map<string, ReservationBucket>> {
  const rows = await tx
    .select({ respondentId: sql<string>`r.respondent_id`, bucket: sql<string>`r.bucket`, amount: sql<string>`sum(r.amount)` })
    .from(
      sql`(
        select respondent_id, to_bucket as bucket, amount_cents as amount from ${ledgerEntries}
          where study_id = ${studyId} and respondent_id is not null and to_bucket in ('allocated_pay', 'held_review')
        union all
        select respondent_id, from_bucket as bucket, -amount_cents as amount from ${ledgerEntries}
          where study_id = ${studyId} and respondent_id is not null and from_bucket in ('allocated_pay', 'held_review')
      ) as r`,
    )
    .groupBy(sql`r.respondent_id`, sql`r.bucket`);
  const result = new Map<string, ReservationBucket>();
  for (const row of rows) {
    if (Number(row.amount) > 0) {
      result.set(row.respondentId, row.bucket as ReservationBucket);
    }
  }
  return result;
}

/** Moves reserved money so it matches every respondent's current decision. Returns respondents the budget can't cover. */
export async function syncReservations(tx: Transaction, studyId: string, sourceEvent: string): Promise<string[]> {
  const [study] = await tx.select({ amount: studies.amountPerParticipantCents }).from(studies).where(eq(studies.id, studyId));
  if (!study) {
    throw new Error("Study not found.");
  }
  const people = await tx
    .select({ id: respondents.id, decision: respondents.currentDecision })
    .from(respondents)
    .where(eq(respondents.studyId, studyId))
    .orderBy(sql`${respondents.submittedAt} asc nulls last`, asc(respondents.rowNumber));
  const live = await tx
    .select({ respondentId: payoutItems.respondentId })
    .from(payoutItems)
    .where(and(eq(payoutItems.studyId, studyId), sql`${payoutItems.status} not in (${sql.join(RELEASED_ITEM_STATUSES.map((status) => sql`${status}`), sql`, `)})`));
  const liveSet = new Set(live.map((row) => row.respondentId));
  const reserved = await reservedBuckets(tx, studyId);
  const balances = await getBalances(tx, studyId);

  const states: ReservationState[] = people.map((person) => ({
    respondentId: person.id,
    decision: person.decision,
    reserved: reserved.get(person.id) ?? null,
    hasLivePayout: liveSet.has(person.id),
  }));
  const plan = planReservations(states, study.amount, balances.unallocated);
  await appendLedger(
    tx,
    studyId,
    plan.moves.map((move) => ({ respondentId: move.respondentId, from: move.from, to: move.to, amountCents: move.amountCents, reason: move.reason, sourceEvent })),
  );
  return plan.unfunded;
}

export async function respondentReservation(tx: Executor, studyId: string, respondentIds: string[]): Promise<Map<string, number>> {
  if (respondentIds.length === 0) {
    return new Map();
  }
  const rows = await tx
    .select({
      respondentId: ledgerEntries.respondentId,
      amount: sql<string>`sum(case when ${ledgerEntries.toBucket} = 'allocated_pay' then ${ledgerEntries.amountCents} when ${ledgerEntries.fromBucket} = 'allocated_pay' then -${ledgerEntries.amountCents} else 0 end)`,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.studyId, studyId), inArray(ledgerEntries.respondentId, respondentIds)))
    .groupBy(ledgerEntries.respondentId);
  return new Map(rows.filter((row) => row.respondentId !== null).map((row) => [row.respondentId as string, Number(row.amount)]));
}
