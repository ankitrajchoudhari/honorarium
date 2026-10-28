import { and, eq, inArray, isNotNull, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayPalResult } from "@/paypal/client";
import type { BatchItem } from "@/paypal/payouts";

const fake = vi.hoisted(() => ({
  createCalls: [] as { senderBatchId: string; requestId: string; items: number }[],
  itemStatus: "PENDING",
}));

// PayPal is the only fake: every database write, lock, ledger move and state transition below is real.
vi.mock("@/paypal/payouts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/paypal/payouts")>();
  const batches = new Map<string, { senderItemIds: string[] }>();
  return {
    ...actual,
    createBatch: async (_client: unknown, request: ReturnType<typeof actual.buildCreateBatchRequest>, requestId: string): Promise<PayPalResult> => {
      fake.createCalls.push({ senderBatchId: request.sender_batch_header.sender_batch_id, requestId, items: request.items.length });
      const payoutBatchId = `FAKE${request.sender_batch_header.sender_batch_id}`;
      batches.set(payoutBatchId, { senderItemIds: request.items.map((item) => item.sender_item_id) });
      return { ok: true, status: 201, debugId: null, body: { batch_header: { payout_batch_id: payoutBatchId, batch_status: "PENDING" } } };
    },
    getBatch: async (_client: unknown, payoutBatchId: string) => {
      const batch = batches.get(payoutBatchId);
      const items: BatchItem[] = (batch?.senderItemIds ?? []).map((senderItemId) => ({
        payout_item_id: `ITEM_${senderItemId}`,
        transaction_status: fake.itemStatus,
        payout_item: { sender_item_id: senderItemId },
      }));
      return { ok: true as const, status: "PROCESSING", items };
    },
  };
});

const { db, withStudyLock } = await import("@/db/client");
const { decisions, payoutItems, respondents, studies, webhookEvents, workspaces } = await import("@/db/schema");
const { getStudy, listStudies } = await import("@/db/queries");
const { recordDecision } = await import("@/decisions/service");
const { jobState, startVerification } = await import("@/jobs/verify");
const { getBalances, ledgerStatus, syncReservations } = await import("@/ledger/ledger");
const { approveAndSend, PayoutError, processWebhookEvent } = await import("@/payouts/service");
const { createSampleStudy } = await import("@/studies/sample");

type Study = typeof studies.$inferSelect;

const created: string[] = [];

async function newWorkspace(): Promise<string> {
  const [row] = await db().insert(workspaces).values({ name: "Integration test" }).returning({ id: workspaces.id });
  if (!row) {
    throw new Error("workspace not created");
  }
  created.push(row.id);
  return row.id;
}

async function loadStudy(id: string): Promise<Study> {
  const [row] = await db().select().from(studies).where(eq(studies.id, id));
  if (!row) {
    throw new Error("study missing");
  }
  return row;
}

/** Marks `count` respondents with distinct, usable emails as Pay (as a reviewer would) and reserves their money. */
async function decidePay(study: Study, count: number): Promise<string[]> {
  const people = await db()
    .select({ id: respondents.id, normalized: respondents.payoutIdentityNormalized })
    .from(respondents)
    .where(and(eq(respondents.studyId, study.id), eq(respondents.payoutIdentityType, "email"), isNotNull(respondents.payoutIdentityNormalized)))
    .orderBy(respondents.rowNumber);
  const seen = new Set<string>();
  const chosen = people.filter((person) => !seen.has(person.normalized ?? "") && seen.add(person.normalized ?? "")).slice(0, count);
  await withStudyLock(study.id, async (tx) => {
    for (const person of chosen) {
      await recordDecision(tx, { studyId: study.id, respondentId: person.id, decision: "pay", source: "reviewer", reasons: [{ summary: "Integration test" }], decidedBy: "Test" });
    }
    await syncReservations(tx, study.id, "test");
  });
  return chosen.map((person) => person.id);
}

async function expectBalanced(study: Study) {
  const status = await ledgerStatus(db(), study.id, study.budgetCents);
  expect(status.invariant.balanced).toBe(true);
  return status.balances;
}

let workspaceA: string;
let workspaceB: string;
let sampleId: string;

beforeAll(async () => {
  workspaceA = await newWorkspace();
  workspaceB = await newWorkspace();
  sampleId = await createSampleStudy(workspaceA);
});

afterAll(async () => {
  // Cascades to studies, batches, items and ledger rows; webhook rows are matched by this suite's own event ids only.
  if (created.length > 0) {
    await db().delete(workspaces).where(inArray(workspaces.id, created));
  }
  await db().delete(webhookEvents).where(like(webhookEvents.paypalEventId, "WH-TEST-%"));
});

beforeEach(() => {
  fake.createCalls.length = 0;
  fake.itemStatus = "PENDING";
});

describe("workspace isolation", () => {
  it("one workspace can never read another's study or job", async () => {
    const study = await loadStudy(sampleId);
    expect(await getStudy(workspaceA, study.id)).not.toBeNull();
    expect(await getStudy(workspaceB, study.id)).toBeNull();
    expect(await listStudies(workspaceB)).toEqual([]);
    const jobId = await startVerification(study);
    expect(await jobState(workspaceA, jobId)).not.toBeNull();
    expect(await jobState(workspaceB, jobId)).toBeNull();
  });
});

describe("payout approval", () => {
  it("a double submit with the same approval creates one batch and one PayPal call", async () => {
    const workspace = await newWorkspace();
    const study = await loadStudy(await createSampleStudy(workspace));
    await decidePay(study, 3);
    const nonce = crypto.randomUUID();

    const [first, second] = await Promise.all([approveAndSend(study, "Test PI", nonce), approveAndSend(study, "Test PI", nonce)]);
    expect(first.length + second.length).toBe(1);
    expect(fake.createCalls).toHaveLength(1);
    expect(fake.createCalls[0]?.items).toBe(3);
    expect(fake.createCalls[0]?.senderBatchId).toMatch(new RegExp(`^hon_SLEEP26_${study.id.replace(/-/g, "").slice(0, 8)}_1$`));

    const balances = await expectBalanced(study);
    expect(balances.in_flight).toBe(3 * study.amountPerParticipantCents);
    expect(balances.allocated_pay).toBe(0);
  });

  it("two different approvals at once still pay each respondent only once", async () => {
    const workspace = await newWorkspace();
    const study = await loadStudy(await createSampleStudy(workspace));
    await decidePay(study, 2);

    const results = await Promise.allSettled([approveAndSend(study, "Test PI", crypto.randomUUID()), approveAndSend(study, "Test PI", crypto.randomUUID())]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(PayoutError);

    const items = await db().select().from(payoutItems).where(eq(payoutItems.studyId, study.id));
    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.respondentId)).size).toBe(2);
    await expectBalanced(study);
  });

  it("the same sample study in two workspaces gets different PayPal batch ids", async () => {
    const one = await loadStudy(await createSampleStudy(await newWorkspace()));
    const two = await loadStudy(await createSampleStudy(await newWorkspace()));
    await decidePay(one, 1);
    await decidePay(two, 1);
    await approveAndSend(one, "Test PI", crypto.randomUUID());
    await approveAndSend(two, "Test PI", crypto.randomUUID());
    const ids = fake.createCalls.map((call) => call.senderBatchId);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("webhooks and the ledger", () => {
  async function storeEvent(eventType: string, paypalItemId: string): Promise<string> {
    const paypalEventId = `WH-TEST-${crypto.randomUUID()}`;
    const [row] = await db()
      .insert(webhookEvents)
      .values({ paypalEventId, eventType, resourceId: paypalItemId, verified: true, payloadJson: { id: paypalEventId, event_type: eventType, resource: { payout_item_id: paypalItemId } } })
      .returning({ id: webhookEvents.id });
    if (!row) {
      throw new Error("event not stored");
    }
    return row.id;
  }

  it("applies success once, ignores a replay and a late hold, and keeps the books balanced", async () => {
    const workspace = await newWorkspace();
    const study = await loadStudy(await createSampleStudy(workspace));
    await decidePay(study, 1);
    await approveAndSend(study, "Test PI", crypto.randomUUID());
    const [item] = await db().select().from(payoutItems).where(eq(payoutItems.studyId, study.id));
    expect(item?.paypalItemId).toBeTruthy();
    const paypalItemId = item?.paypalItemId ?? "";

    const success = await storeEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", paypalItemId);
    expect(await processWebhookEvent(success)).toBe("applied SUCCESS");
    expect(await processWebhookEvent(success)).toBe("skipped");
    const lateHold = await storeEvent("PAYMENT.PAYOUTS-ITEM.HELD", paypalItemId);
    expect(await processWebhookEvent(lateHold)).toMatch(/^ignored: SUCCESS → ONHOLD/);

    const balances = await expectBalanced(study);
    expect(balances.paid).toBe(study.amountPerParticipantCents);
    expect(balances.in_flight).toBe(0);
  });

  it("a failed payout returns the money and sends the respondent back to review, reserved", async () => {
    const workspace = await newWorkspace();
    const study = await loadStudy(await createSampleStudy(workspace));
    const [respondentId] = await decidePay(study, 1);
    const before = await getBalances(db(), study.id);
    await approveAndSend(study, "Test PI", crypto.randomUUID());
    const [item] = await db().select().from(payoutItems).where(eq(payoutItems.studyId, study.id));

    const failed = await storeEvent("PAYMENT.PAYOUTS-ITEM.FAILED", item?.paypalItemId ?? "");
    expect(await processWebhookEvent(failed)).toBe("applied FAILED");

    const [person] = await db().select().from(respondents).where(eq(respondents.id, respondentId ?? ""));
    expect(person?.currentDecision).toBe("hold");
    expect(person?.currentDecisionSource).toBe("payout");
    const balances = await expectBalanced(study);
    expect(balances.in_flight).toBe(0);
    expect(balances.held_review).toBe(before.held_review + study.amountPerParticipantCents);
    const history = await db().select().from(decisions).where(eq(decisions.respondentId, respondentId ?? ""));
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it("unverified events are stored but never processed", async () => {
    const paypalEventId = `WH-TEST-${crypto.randomUUID()}`;
    const [row] = await db()
      .insert(webhookEvents)
      .values({ paypalEventId, eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", verified: false, payloadJson: { id: paypalEventId } })
      .returning({ id: webhookEvents.id });
    expect(await processWebhookEvent(row?.id ?? "")).toBe("skipped");
  });
});

