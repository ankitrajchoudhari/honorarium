import { z } from "zod";
import { centsToDecimalString } from "@/lib/money";
import type { PayPalClient, PayPalResult } from "@/paypal/client";

/** Verified maximum items per Payouts call (payout_item_request_list.maxItems). */
export const MAX_ITEMS_PER_BATCH = 15_000;

export interface PayoutItemInput {
  senderItemId: string;
  recipientType: "EMAIL" | "PHONE";
  receiver: string;
  amountCents: number;
  note: string;
}

export interface CreateBatchInput {
  senderBatchId: string;
  emailSubject: string;
  emailMessage: string;
  currency: string;
  items: PayoutItemInput[];
}

export function buildCreateBatchRequest(input: CreateBatchInput) {
  if (input.items.length === 0 || input.items.length > MAX_ITEMS_PER_BATCH) {
    throw new Error(`A payout batch needs 1–${MAX_ITEMS_PER_BATCH} items.`);
  }
  return {
    sender_batch_header: {
      sender_batch_id: input.senderBatchId,
      email_subject: input.emailSubject,
      email_message: input.emailMessage,
    },
    items: input.items.map((item) => ({
      recipient_type: item.recipientType,
      amount: { value: centsToDecimalString(item.amountCents), currency: input.currency },
      receiver: item.receiver,
      sender_item_id: item.senderItemId,
      note: item.note,
      recipient_wallet: "PAYPAL",
    })),
  };
}

const batchHeaderSchema = z.object({
  payout_batch_id: z.string(),
  batch_status: z.string(),
});

export const createBatchResponseSchema = z.object({ batch_header: batchHeaderSchema });

const errorsSchema = z.object({ name: z.string().optional(), message: z.string().optional() }).loose();

export const batchItemSchema = z.object({
  payout_item_id: z.string(),
  transaction_id: z.string().optional(),
  transaction_status: z.string().optional(),
  time_processed: z.string().optional(),
  payout_item: z.object({ sender_item_id: z.string().optional() }).loose(),
  errors: errorsSchema.optional(),
});

export const batchResponseSchema = z.object({
  batch_header: batchHeaderSchema,
  items: z.array(batchItemSchema).optional(),
  total_pages: z.number().optional(),
});

export type BatchItem = z.infer<typeof batchItemSchema>;

export async function createBatch(client: PayPalClient, request: ReturnType<typeof buildCreateBatchRequest>, requestId: string): Promise<PayPalResult> {
  return client.request("POST", "/v1/payments/payouts", { body: request, requestId });
}

/** Reads every page of a batch's items. */
export async function getBatch(client: PayPalClient, payoutBatchId: string): Promise<{ ok: true; status: string; items: BatchItem[] } | Extract<PayPalResult, { ok: false }>> {
  const items: BatchItem[] = [];
  let status = "";
  for (let page = 1; page <= 30; page += 1) {
    const result = await client.request("GET", `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}?page=${page}&page_size=1000&total_required=true`);
    if (!result.ok) {
      return result;
    }
    const parsed = batchResponseSchema.safeParse(result.body);
    if (!parsed.success) {
      return { ok: false, status: result.status, name: "UNEXPECTED_RESPONSE", message: "PayPal returned a batch in an unexpected format.", issues: [], debugId: result.debugId, uncertain: true };
    }
    status = parsed.data.batch_header.batch_status;
    items.push(...(parsed.data.items ?? []));
    if (!parsed.data.total_pages || page >= parsed.data.total_pages) {
      break;
    }
  }
  return { ok: true, status, items };
}

export async function getItem(client: PayPalClient, payoutItemId: string): Promise<PayPalResult> {
  return client.request("GET", `/v1/payments/payouts-item/${encodeURIComponent(payoutItemId)}`);
}

export async function cancelUnclaimedItem(client: PayPalClient, payoutItemId: string, requestId: string): Promise<PayPalResult> {
  return client.request("POST", `/v1/payments/payouts-item/${encodeURIComponent(payoutItemId)}/cancel`, { requestId });
}
