import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, withStudyLock, type Transaction } from "@/db/client";
import { audit } from "@/db/audit";
import { payoutBatches, payoutItems, respondents, RELEASED_ITEM_STATUSES, studies, webhookEvents } from "@/db/schema";
import { touchStudy, type Study } from "@/db/queries";
import { recordDecision } from "@/decisions/service";
import { checkInvariant } from "@/ledger/buckets";
import { appendLedger, getBalances, respondentReservation, syncReservations } from "@/ledger/ledger";
import { env, PAYPAL_API_BASE } from "@/lib/env";
import { PayPalClient, type PayPalResult } from "@/paypal/client";
import { buildCreateBatchRequest, cancelUnclaimedItem, createBatch, createBatchResponseSchema, getBatch, MAX_ITEMS_PER_BATCH, type BatchItem } from "@/paypal/payouts";
import { bucketFor, canTransition, ITEM_EVENT_STATUS, parseItemStatus, plainReason, type ItemStatus } from "@/paypal/state";
import { runPreflight, type PayoutCandidate, type PreflightResult } from "@/payouts/preflight";

export class PayoutError extends Error {
  constructor(
    message: string,
    public readonly debugId: string | null = null,
  ) {
    super(message);
    this.name = "PayoutError";
  }
}

let client: PayPalClient | undefined;

export function paypal(): PayPalClient {
  client ??= new PayPalClient({ baseUrl: PAYPAL_API_BASE, clientId: env().PAYPAL_CLIENT_ID, clientSecret: env().PAYPAL_CLIENT_SECRET });
  return client;
}

export type BatchRow = typeof payoutBatches.$inferSelect;
export type ItemRow = typeof payoutItems.$inferSelect;

const releasedSql = sql.join(
  RELEASED_ITEM_STATUSES.map((status) => sql`${status}`),
  sql`, `,
);

export function payoutNote(study: Study): string {
  return `Thank you for taking part in "${study.title}". This is your participant payment.`;
}

export function emailSubject(study: Study): string {
  return `Thank you for taking part in ${study.title}`.slice(0, 255);
}

export async function preflight(study: Study, executor: Transaction | ReturnType<typeof db> = db()): Promise<PreflightResult> {
  const people = await executor
    .select({
      id: respondents.id,
      ref: respondents.respondentRef,
      type: respondents.payoutIdentityType,
      raw: respondents.payoutIdentityRaw,
      normalized: respondents.payoutIdentityNormalized,
      submittedAt: respondents.submittedAt,
    })
    .from(respondents)
    .where(and(eq(respondents.studyId, study.id), eq(respondents.currentDecision, "pay")));
  const ids = people.map((person) => person.id);
  const items =
    ids.length === 0
      ? []
      : await executor
          .select({ respondentId: payoutItems.respondentId, status: payoutItems.status, identity: payoutItems.identityNormalized })
          .from(payoutItems)
          .where(and(eq(payoutItems.studyId, study.id), inArray(payoutItems.respondentId, ids)));
  const reserved = await respondentReservation(executor, study.id, ids);
  const balances = await getBalances(executor, study.id);
  const candidates: PayoutCandidate[] = people.map((person) => {
    const own = items.filter((item) => item.respondentId === person.id);
    return {
      respondentId: person.id,
      ref: person.ref,
      identityType: person.type,
      identityRaw: person.raw,
      identityNormalized: person.normalized,
      submittedAt: person.submittedAt,
      reservedCents: reserved.get(person.id) ?? 0,
      hasLiveItem: own.some((item) => !(RELEASED_ITEM_STATUSES as readonly string[]).includes(item.status)),
      failedIdentities: own.filter((item) => item.status === "FAILED").map((item) => item.identity),
    };
  });
  return runPreflight(candidates, {
    amountCents: study.amountPerParticipantCents,
    studyCurrency: study.currency,
    payoutCurrency: "USD",
    ledgerBalanced: checkInvariant(study.budgetCents, balances).balanced,
    allocatedPayCents: balances.allocated_pay,
  });
}

function receiverFor(candidate: PayoutCandidate): { recipientType: "EMAIL" | "PHONE"; receiver: string } {
  if (candidate.identityType === "phone") {
    const digits = candidate.identityNormalized ?? "";
    return { recipientType: "PHONE", receiver: digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits };
  }
  return { recipientType: "EMAIL", receiver: (candidate.identityRaw ?? "").trim() };
}

/**
 * Approval: re-runs pre-flight inside the study lock, writes the batch, its items and the
 * allocated_pay → in_flight ledger moves, then sends to PayPal. The approval nonce makes a double submit a no-op.
 */
export async function approveAndSend(study: Study, approver: string, approvalNonce: string): Promise<string[]> {
  const created = await withStudyLock(study.id, async (tx) => {
    const [repeat] = await tx.select({ id: payoutBatches.id }).from(payoutBatches).where(eq(payoutBatches.approvalNonce, approvalNonce));
    if (repeat) {
      return [];
    }
    const check = await preflight(study, tx);
    if (!check.ready) {
      throw new PayoutError(check.eligible.length === 0 ? "Nobody is ready to be paid." : "A pre-flight check failed. Review the checklist.");
    }
    const [last] = await tx.select({ number: payoutBatches.batchNumber }).from(payoutBatches).where(eq(payoutBatches.studyId, study.id)).orderBy(desc(payoutBatches.batchNumber)).limit(1);
    // Short codes repeat across workspaces (every sample study is SLEEP-26), and PayPal rejects a reused
    // sender_batch_id, so the study's own id makes the batch id unique while staying deterministic.
    const code = `${study.shortCode.replace(/[^A-Z0-9]/g, "")}_${study.id.replace(/-/g, "").slice(0, 8)}`;
    const batchIds: string[] = [];
    for (let start = 0, index = 0; start < check.eligible.length; start += MAX_ITEMS_PER_BATCH, index += 1) {
      const slice = check.eligible.slice(start, start + MAX_ITEMS_PER_BATCH);
      const batchNumber = (last?.number ?? 0) + index + 1;
      const senderBatchId = `hon_${code}_${batchNumber}`;
      const items = slice.map((candidate) => ({ candidate, senderItemId: `${senderBatchId}_${candidate.ref}`, ...receiverFor(candidate) }));
      const request = buildCreateBatchRequest({
        senderBatchId,
        emailSubject: emailSubject(study),
        emailMessage: payoutNote(study),
        currency: study.currency,
        items: items.map((item) => ({ senderItemId: item.senderItemId, recipientType: item.recipientType, receiver: item.receiver, amountCents: study.amountPerParticipantCents, note: payoutNote(study) })),
      });
      const [batch] = await tx
        .insert(payoutBatches)
        .values({
          studyId: study.id,
          batchNumber,
          senderBatchId,
          approvalNonce: index === 0 ? approvalNonce : `${approvalNonce}:${index}`,
          itemCount: slice.length,
          totalCents: slice.length * study.amountPerParticipantCents,
          approvedBy: approver,
          emailSubject: emailSubject(study),
          requestJson: request,
        })
        .returning({ id: payoutBatches.id });
      if (!batch) {
        throw new PayoutError("The batch could not be saved.");
      }
      const inserted = await tx
        .insert(payoutItems)
        .values(
          items.map((item) => ({
            batchId: batch.id,
            studyId: study.id,
            respondentId: item.candidate.respondentId,
            senderItemId: item.senderItemId,
            receiver: item.receiver,
            recipientType: item.recipientType,
            identityNormalized: item.candidate.identityNormalized ?? "",
            amountCents: study.amountPerParticipantCents,
          })),
        )
        .returning({ id: payoutItems.id, respondentId: payoutItems.respondentId });
      await appendLedger(
        tx,
        study.id,
        inserted.map((item) => ({
          respondentId: item.respondentId,
          payoutItemId: item.id,
          from: "allocated_pay",
          to: "in_flight",
          amountCents: study.amountPerParticipantCents,
          reason: `Sent in batch ${senderBatchId}`,
          sourceEvent: "batch_created",
        })),
      );
      await audit(tx, {
        workspaceId: study.workspaceId,
        studyId: study.id,
        actor: approver,
        action: "payout.approved",
        target: senderBatchId,
        after: { items: slice.length, totalCents: slice.length * study.amountPerParticipantCents },
      });
      batchIds.push(batch.id);
    }
    await touchStudy(tx, study.id, "paying");
    return batchIds;
  });
  for (const batchId of created) {
    await sendBatch(study, batchId);
  }
  return created;
}

function errorJson(result: Extract<PayPalResult, { ok: false }>) {
  return { name: result.name, message: result.message, issues: result.issues, debugId: result.debugId, status: result.status };
}

/** Sends (or re-sends) a stored batch with the same sender_batch_id and PayPal-Request-Id, so PayPal deduplicates. */
export async function sendBatch(study: Study, batchId: string): Promise<void> {
  const [batch] = await db().select().from(payoutBatches).where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.studyId, study.id)));
  if (!batch || !(batch.status === "created" || batch.status === "request_failed")) {
    return;
  }
  const result = await createBatch(paypal(), batch.requestJson as ReturnType<typeof buildCreateBatchRequest>, batch.id);
  await withStudyLock(study.id, async (tx) => {
    if (result.ok) {
      const parsed = createBatchResponseSchema.safeParse(result.body);
      const header = parsed.success ? parsed.data.batch_header : null;
      const status = header && ["PENDING", "PROCESSING", "SUCCESS", "DENIED"].includes(header.batch_status) ? (header.batch_status as BatchRow["status"]) : "PENDING";
      await tx.update(payoutBatches).set({ status, paypalBatchId: header?.payout_batch_id ?? null, responseJson: result.body, errorJson: null }).where(eq(payoutBatches.id, batch.id));
      return;
    }
    if (result.uncertain) {
      await tx.update(payoutBatches).set({ status: "request_failed", errorJson: errorJson(result) }).where(eq(payoutBatches.id, batch.id));
      return;
    }
    await tx.update(payoutBatches).set({ status: "rejected", errorJson: errorJson(result) }).where(eq(payoutBatches.id, batch.id));
    const items = await tx.select().from(payoutItems).where(eq(payoutItems.batchId, batch.id));
    for (const item of items) {
      await applyItemStatus(tx, study, item, { status: "NOT_SENT", error: errorJson(result) }, "batch_rejected");
    }
    await syncReservations(tx, study.id, "batch_rejected");
  });
  if (result.ok) {
    await refreshBatch(study, batch.id, "poll");
  }
}

interface ItemUpdate {
  status: ItemStatus;
  paypalItemId?: string | null;
  transactionId?: string | null;
  error?: unknown;
  decisionNote?: string;
}

/** The single place an item's status changes. Out-of-order or repeated updates are ignored by the state machine. */
export async function applyItemStatus(tx: Transaction, study: Study, item: ItemRow, update: ItemUpdate, sourceEvent: string): Promise<boolean> {
  const ids: Partial<ItemRow> = {};
  if (update.paypalItemId && !item.paypalItemId) {
    ids.paypalItemId = update.paypalItemId;
  }
  if (update.transactionId && !item.transactionId) {
    ids.transactionId = update.transactionId;
  }
  if (!canTransition(item.status, update.status)) {
    if (Object.keys(ids).length > 0) {
      await tx.update(payoutItems).set(ids).where(eq(payoutItems.id, item.id));
    }
    return false;
  }
  const now = new Date();
  await tx
    .update(payoutItems)
    .set({
      ...ids,
      status: update.status,
      lastEventAt: now,
      errorJson: update.error ?? item.errorJson,
      unclaimedSince: update.status === "UNCLAIMED" ? (item.unclaimedSince ?? now) : item.unclaimedSince,
    })
    .where(eq(payoutItems.id, item.id));
  const from = bucketFor(item.status);
  const to = bucketFor(update.status);
  if (from !== to) {
    await appendLedger(tx, study.id, [
      { respondentId: item.respondentId, payoutItemId: item.id, from, to, amountCents: item.amountCents, reason: `PayPal ${item.status} → ${update.status}`, sourceEvent },
    ]);
  }
  if (["FAILED", "RETURNED", "REFUNDED", "REVERSED", "NOT_SENT"].includes(update.status)) {
    const errorName = typeof update.error === "object" && update.error !== null ? ((update.error as Record<string, unknown>).name as string | undefined) : undefined;
    const summary =
      update.decisionNote ??
      (update.status === "FAILED"
        ? `Payout failed: ${plainReason(errorName)}`
        : update.status === "NOT_SENT"
          ? "PayPal rejected the batch; nothing was sent"
          : `PayPal reported ${update.status.toLowerCase()}; money is back in the budget`);
    await recordDecision(tx, { studyId: study.id, respondentId: item.respondentId, decision: "hold", source: "payout", reasons: [{ summary }], decidedBy: "PayPal" });
  }
  return true;
}

function errorsOf(item: BatchItem): unknown {
  return item.errors ? { name: item.errors.name ?? null, message: item.errors.message ?? null } : null;
}

/** Polls PayPal for a batch and applies each item's status through the state machine. */
export async function refreshBatch(study: Study, batchId: string, sourceEvent: string): Promise<{ changed: number; error?: string; debugId?: string | null }> {
  const [batch] = await db().select().from(payoutBatches).where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.studyId, study.id)));
  if (!batch?.paypalBatchId) {
    return { changed: 0 };
  }
  const result = await getBatch(paypal(), batch.paypalBatchId);
  if (!result.ok) {
    return { changed: 0, error: `${result.message}${result.issues.length ? ` (${result.issues.join("; ")})` : ""}`, debugId: result.debugId };
  }
  return withStudyLock(study.id, async (tx) => {
    const items = await tx.select().from(payoutItems).where(eq(payoutItems.batchId, batch.id));
    const bySender = new Map(items.map((item) => [item.senderItemId, item]));
    let changed = 0;
    for (const remote of result.items) {
      const local = remote.payout_item.sender_item_id ? bySender.get(remote.payout_item.sender_item_id) : undefined;
      const status = parseItemStatus(remote.transaction_status);
      if (!local || !status) {
        continue;
      }
      if (await applyItemStatus(tx, study, local, { status, paypalItemId: remote.payout_item_id, transactionId: remote.transaction_id ?? null, error: errorsOf(remote) }, sourceEvent)) {
        changed += 1;
      }
    }
    if (["PENDING", "PROCESSING", "SUCCESS", "DENIED", "CANCELED"].includes(result.status)) {
      await tx.update(payoutBatches).set({ status: result.status as BatchRow["status"] }).where(eq(payoutBatches.id, batch.id));
    }
    await syncReservations(tx, study.id, sourceEvent);
    return { changed };
  });
}

export async function cancelUnclaimed(study: Study, itemId: string, actor: string, reason: string): Promise<void> {
  const [row] = await db()
    .select({ item: payoutItems, batch: payoutBatches })
    .from(payoutItems)
    .innerJoin(payoutBatches, eq(payoutBatches.id, payoutItems.batchId))
    .where(and(eq(payoutItems.id, itemId), eq(payoutItems.studyId, study.id)));
  if (!row || row.item.status !== "UNCLAIMED" || !row.item.paypalItemId) {
    throw new PayoutError("Only unclaimed payouts can be cancelled.");
  }
  if (row.batch.status !== "SUCCESS") {
    throw new PayoutError("PayPal allows cancelling only after the whole batch has finished processing. Refresh statuses and try again.");
  }
  const result = await cancelUnclaimedItem(paypal(), row.item.paypalItemId, `cancel-${row.item.id}`);
  if (!result.ok) {
    throw new PayoutError(`PayPal could not cancel this payout right now: ${result.message}`, result.debugId);
  }
  const status = parseItemStatus((result.body as Record<string, unknown> | null)?.transaction_status);
  await withStudyLock(study.id, async (tx) => {
    const [fresh] = await tx.select().from(payoutItems).where(eq(payoutItems.id, row.item.id));
    if (fresh && status === "RETURNED") {
      await applyItemStatus(tx, study, fresh, { status, decisionNote: `Payout cancelled by ${actor}: ${reason}` }, "cancel");
      await syncReservations(tx, study.id, "cancel");
    }
    await audit(tx, { workspaceId: study.workspaceId, studyId: study.id, actor, action: "payout.cancelled", target: row.item.senderItemId, after: { reason, status } });
  });
}

/** Processes a stored, verified webhook event exactly once. */
export async function processWebhookEvent(eventRowId: string): Promise<string> {
  const [event] = await db().select().from(webhookEvents).where(eq(webhookEvents.id, eventRowId));
  if (!event || !event.verified || event.processedAt) {
    return "skipped";
  }
  const payload = event.payloadJson as { event_type?: string; resource?: Record<string, unknown> };
  const resource = payload.resource ?? {};
  let outcome = "ignored: unknown event type";
  const itemStatus = ITEM_EVENT_STATUS[event.eventType];
  if (itemStatus) {
    const paypalItemId = typeof resource.payout_item_id === "string" ? resource.payout_item_id : null;
    const senderItemId = typeof (resource.payout_item as Record<string, unknown> | undefined)?.sender_item_id === "string" ? ((resource.payout_item as Record<string, unknown>).sender_item_id as string) : null;
    const [found] = await db()
      .select({ item: payoutItems, study: studies })
      .from(payoutItems)
      .innerJoin(studies, eq(studies.id, payoutItems.studyId))
      .where(paypalItemId ? eq(payoutItems.paypalItemId, paypalItemId) : eq(payoutItems.senderItemId, senderItemId ?? "-"));
    if (!found) {
      outcome = "ignored: item not found";
    } else {
      outcome = await withStudyLock(found.study.id, async (tx) => {
        const [fresh] = await tx.select().from(payoutItems).where(eq(payoutItems.id, found.item.id));
        if (!fresh) {
          return "ignored: item vanished";
        }
        const changed = await applyItemStatus(
          tx,
          found.study,
          fresh,
          { status: itemStatus, paypalItemId, transactionId: typeof resource.transaction_id === "string" ? resource.transaction_id : null },
          `webhook:${event.paypalEventId}`,
        );
        await syncReservations(tx, found.study.id, `webhook:${event.paypalEventId}`);
        return changed ? `applied ${itemStatus}` : `ignored: ${fresh.status} → ${itemStatus} is not a forward transition`;
      });
    }
  } else if (event.eventType.startsWith("PAYMENT.PAYOUTSBATCH.")) {
    const batchId = typeof (resource.batch_header as Record<string, unknown> | undefined)?.payout_batch_id === "string" ? ((resource.batch_header as Record<string, unknown>).payout_batch_id as string) : null;
    const [found] = batchId
      ? await db().select({ batch: payoutBatches, study: studies }).from(payoutBatches).innerJoin(studies, eq(studies.id, payoutBatches.studyId)).where(eq(payoutBatches.paypalBatchId, batchId))
      : [];
    if (found) {
      const refreshed = await refreshBatch(found.study, found.batch.id, `webhook:${event.paypalEventId}`);
      outcome = refreshed.error ? `refresh failed: ${refreshed.error}` : `refreshed batch, ${refreshed.changed} item(s) changed`;
    } else {
      outcome = "ignored: batch not found";
    }
  }
  await db().update(webhookEvents).set({ processedAt: new Date(), processResult: outcome }).where(eq(webhookEvents.id, event.id));
  return outcome;
}

/** A batch still "created" after this long was saved but never reached PayPal (e.g. the server stopped mid-request). */
const STUCK_AFTER_MS = 2 * 60_000;

export function batchIsStuck(batch: BatchRow, now: Date = new Date()): boolean {
  return batch.status === "created" && now.getTime() - batch.approvedAt.getTime() > STUCK_AFTER_MS;
}

export async function batchesFor(studyId: string): Promise<BatchRow[]> {
  return db().select().from(payoutBatches).where(eq(payoutBatches.studyId, studyId)).orderBy(desc(payoutBatches.batchNumber));
}

export async function itemsFor(studyId: string) {
  return db()
    .select({ item: payoutItems, ref: respondents.respondentRef, batchNumber: payoutBatches.batchNumber, batchStatus: payoutBatches.status })
    .from(payoutItems)
    .innerJoin(respondents, eq(respondents.id, payoutItems.respondentId))
    .innerJoin(payoutBatches, eq(payoutBatches.id, payoutItems.batchId))
    .where(eq(payoutItems.studyId, studyId))
    .orderBy(desc(payoutBatches.batchNumber), respondents.respondentRef);
}

export async function liveItemCount(studyId: string): Promise<number> {
  const [row] = await db()
    .select({ total: sql<number>`count(*)::int` })
    .from(payoutItems)
    .where(and(eq(payoutItems.studyId, studyId), sql`${payoutItems.status} not in (${releasedSql})`));
  return row?.total ?? 0;
}
