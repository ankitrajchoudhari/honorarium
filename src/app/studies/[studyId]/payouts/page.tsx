import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { PageTitle } from "@/components/ui";
import { db } from "@/db/client";
import { decisionCounts } from "@/db/queries";
import { getStudyOr404 } from "@/db/study-page";
import { maskIdentity } from "@/engine/normalize";
import { ledgerStatus } from "@/ledger/ledger";
import { requireWorkspace, reviewerName } from "@/lib/session";
import { isFinal, plainReason, unclaimedDaysLeft, type ItemStatus } from "@/paypal/state";
import { batchesFor, batchIsStuck, emailSubject, itemsFor, payoutNote, preflight } from "@/payouts/service";
import { PayoutsView, type BatchView, type ItemView } from "./payouts-view";

export const metadata: Metadata = { title: "Payouts" };


function errorText(error: unknown): { reason: string | null; debugId: string | null } {
  if (typeof error !== "object" || error === null) {
    return { reason: null, debugId: null };
  }
  const record = error as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : null;
  const message = typeof record.message === "string" ? record.message : null;
  const issues = Array.isArray(record.issues) ? (record.issues as string[]).join("; ") : "";
  return { reason: name ? `${plainReason(name, message)}${issues ? ` (${issues})` : ""}` : message, debugId: typeof record.debugId === "string" ? record.debugId : null };
}

export default async function PayoutsPage({ params }: PageProps<"/studies/[studyId]/payouts">) {
  const { studyId } = await params;
  const workspace = await requireWorkspace();
  const study = await getStudyOr404(workspace.id, studyId);
  const [check, batches, items, ledger, counts, reviewer] = await Promise.all([
    preflight(study),
    batchesFor(study.id),
    itemsFor(study.id),
    ledgerStatus(db(), study.id, study.budgetCents),
    decisionCounts(study.id),
    reviewerName(),
  ]);

  const batchViews: BatchView[] = batches.map((batch) => ({
    id: batch.id,
    number: batch.batchNumber,
    senderBatchId: batch.senderBatchId,
    paypalBatchId: batch.paypalBatchId,
    status: batch.status,
    itemCount: batch.itemCount,
    totalCents: batch.totalCents,
    approvedBy: batch.approvedBy,
    approvedAt: batch.approvedAt.toISOString(),
    ...errorText(batch.errorJson),
    stuck: batchIsStuck(batch),
  }));
  const itemViews: ItemView[] = items.map(({ item, ref, batchNumber, batchStatus }) => {
    const error = errorText(item.errorJson);
    return {
      id: item.id,
      ref,
      batchNumber,
      batchStatus,
      receiver: maskIdentity(item.receiver),
      recipientType: item.recipientType,
      amountCents: item.amountCents,
      status: item.status,
      final: isFinal(item.status as ItemStatus),
      lastEventAt: item.lastEventAt?.toISOString() ?? null,
      paypalItemId: item.paypalItemId,
      daysLeft: item.status === "UNCLAIMED" && item.unclaimedSince ? unclaimedDaysLeft(item.unclaimedSince) : null,
      reason: item.status === "UNCLAIMED" ? null : error.reason,
    };
  });

  return (
    <div className="space-y-6">
      <PageTitle description="Payouts go through PayPal Payouts in sandbox mode. Nothing is sent until the PI approves the batch below.">Payouts</PageTitle>
      <PayoutsView
        studyId={study.id}
        shortCode={study.shortCode}
        amountCents={study.amountPerParticipantCents}
        holds={counts.hold}
        preflight={{
          ready: check.ready,
          checks: check.checks,
          totalCents: check.totalCents,
          count: check.eligible.length,
          batchCount: check.batchCount,
          skipped: check.skipped,
          sample: check.eligible.slice(0, 5).map((entry) => ({ ref: entry.ref, receiver: maskIdentity(entry.identityRaw ?? ""), type: entry.identityType ?? "email" })),
        }}
        unallocatedCents={ledger.balances.unallocated}
        heldCents={ledger.balances.held_review}
        balanced={ledger.invariant.balanced}
        subject={emailSubject(study)}
        note={payoutNote(study)}
        batches={batchViews}
        items={itemViews}
        nonce={randomUUID()}
        defaultApprover={reviewer ?? study.piName}
      />
    </div>
  );
}
