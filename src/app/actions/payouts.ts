"use server";

import { revalidatePath } from "next/cache";
import { getStudy } from "@/db/queries";
import { rateLimitAction, RateLimitError } from "@/lib/rate-limit";
import { requireWorkspace, reviewerName } from "@/lib/session";
import { approveAndSend, batchesFor, cancelUnclaimed, PayoutError, refreshBatch, sendBatch } from "@/payouts/service";

export type PayoutActionResult = { ok: true; message: string } | { ok: false; error: string; debugId?: string | null };

async function context(studyId: string) {
  const workspace = await requireWorkspace();
  const study = await getStudy(workspace.id, studyId);
  if (!study) {
    throw new PayoutError("Study not found.");
  }
  return { workspace, study, actor: (await reviewerName()) ?? null };
}

function failure(error: unknown): PayoutActionResult {
  if (error instanceof PayoutError) {
    return { ok: false, error: error.message, debugId: error.debugId };
  }
  if (error instanceof RateLimitError) {
    return { ok: false, error: error.message };
  }
  throw error;
}

export async function approvePayoutAction(studyId: string, input: { approver: string; code: string; nonce: string }): Promise<PayoutActionResult> {
  try {
    const { workspace, study } = await context(studyId);
    const approver = input.approver.trim();
    if (approver.length < 2) {
      return { ok: false, error: "Enter the approving PI's name." };
    }
    if (input.code.trim().toUpperCase() !== study.shortCode) {
      return { ok: false, error: `Type the study code ${study.shortCode} exactly to approve.` };
    }
    if (!/^[0-9a-f-]{36}$/.test(input.nonce)) {
      return { ok: false, error: "This approval form expired. Reload the page." };
    }
    await rateLimitAction("payout_batch", workspace.id, 10, 3600);
    const created = await approveAndSend(study, approver, input.nonce);
    revalidatePath(`/studies/${studyId}`, "layout");
    return { ok: true, message: created.length === 0 ? "This approval was already submitted." : `Sent ${created.length} batch${created.length === 1 ? "" : "es"} to PayPal.` };
  } catch (error) {
    return failure(error);
  }
}

export async function retrySendAction(studyId: string, batchId: string): Promise<PayoutActionResult> {
  try {
    const { study } = await context(studyId);
    await sendBatch(study, batchId);
    revalidatePath(`/studies/${studyId}`, "layout");
    return { ok: true, message: "Sent again with the same batch ID, so PayPal cannot create a duplicate." };
  } catch (error) {
    return failure(error);
  }
}

export async function refreshStatusesAction(studyId: string): Promise<PayoutActionResult> {
  try {
    const { study } = await context(studyId);
    const batches = await batchesFor(study.id);
    let changed = 0;
    const errors: string[] = [];
    let debugId: string | null = null;
    for (const batch of batches.filter((entry) => entry.paypalBatchId)) {
      const result = await refreshBatch(study, batch.id, "poll");
      changed += result.changed;
      if (result.error) {
        errors.push(result.error);
        debugId = result.debugId ?? debugId;
      }
    }
    revalidatePath(`/studies/${studyId}`, "layout");
    if (errors.length > 0) {
      return { ok: false, error: `PayPal could not be reached for every batch: ${errors[0]}`, debugId };
    }
    return { ok: true, message: changed === 0 ? "No status changes." : `${changed} item${changed === 1 ? "" : "s"} updated.` };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelUnclaimedAction(studyId: string, itemId: string, reason: string): Promise<PayoutActionResult> {
  try {
    const { study, actor } = await context(studyId);
    if (reason.trim().length < 3) {
      return { ok: false, error: "Give a reason for cancelling." };
    }
    await cancelUnclaimed(study, itemId, actor ?? study.piName, reason.trim());
    revalidatePath(`/studies/${studyId}`, "layout");
    return { ok: true, message: "Cancelled. The money is back in the budget." };
  } catch (error) {
    return failure(error);
  }
}
