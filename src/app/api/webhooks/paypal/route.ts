import { and, eq, isNull } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { db } from "@/db/client";
import { webhookEvents } from "@/db/schema";
import { env } from "@/lib/env";
import { clientIp, isLimited, recordHit } from "@/lib/rate-limit";
import { paypal, processWebhookEvent } from "@/payouts/service";
import { readSignatureHeaders, verifyWebhookSignature } from "@/paypal/webhook";

export const maxDuration = 60;

const MAX_BODY_BYTES = 256 * 1024;
/** Senders whose events fail verification this often per hour are refused before PayPal is asked again. */
const MAX_UNVERIFIED_PER_HOUR = 30;

/**
 * PayPal webhook receiver: raw body → signature verified by PayPal → stored (deduplicated by event id) →
 * processed after the response. Unverified events are stored for the record and never processed.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  let event: { id?: unknown; event_type?: unknown; resource?: { payout_item_id?: unknown; batch_header?: { payout_batch_id?: unknown } } };
  try {
    event = JSON.parse(raw) as typeof event;
  } catch {
    return NextResponse.json({ error: "Body is not JSON." }, { status: 400 });
  }
  if (typeof event.id !== "string" || typeof event.event_type !== "string" || event.id.length > 128 || event.event_type.length > 128) {
    return NextResponse.json({ error: "Not a PayPal event." }, { status: 400 });
  }

  const unverifiedKey = `webhook_unverified:ip:${await clientIp()}`;
  if (await isLimited(unverifiedKey, MAX_UNVERIFIED_PER_HOUR, 3600)) {
    return NextResponse.json({ error: "Too many unverified events." }, { status: 429 });
  }
  const webhookId = env().PAYPAL_WEBHOOK_ID;
  const headers = readSignatureHeaders(request.headers);
  const verified = webhookId !== undefined && headers !== null ? await verifyWebhookSignature(paypal(), headers, webhookId, raw) : false;
  const resourceId =
    typeof event.resource?.payout_item_id === "string"
      ? event.resource.payout_item_id
      : typeof event.resource?.batch_header?.payout_batch_id === "string"
        ? event.resource.batch_header.payout_batch_id
        : null;

  if (!verified) {
    await recordHit(unverifiedKey);
  }
  // Unverified bodies are untrusted and could be large, so only their identifying fields are kept for the record.
  const payloadJson = verified ? (JSON.parse(raw) as object) : { id: event.id, event_type: event.event_type, unverified: true };
  const [inserted] = await db()
    .insert(webhookEvents)
    .values({ paypalEventId: event.id, eventType: event.event_type, resourceId: resourceId?.slice(0, 128) ?? null, verified, payloadJson })
    .onConflictDoNothing({ target: webhookEvents.paypalEventId })
    .returning({ id: webhookEvents.id });

  if (!verified) {
    return NextResponse.json({ received: true, processed: false }, { status: webhookId ? 400 : 200 });
  }
  // A redelivery may verify after an earlier attempt could not (PayPal unreachable), or arrive after processing
  // crashed. Either way the stored row is still unprocessed, so it is promoted and processed now; processing is idempotent.
  const [pending] = inserted
    ? [inserted]
    : await db()
        .update(webhookEvents)
        .set({ verified: true, payloadJson })
        .where(and(eq(webhookEvents.paypalEventId, event.id), isNull(webhookEvents.processedAt)))
        .returning({ id: webhookEvents.id });
  if (pending) {
    after(async () => {
      await processWebhookEvent(pending.id);
    });
  }
  return NextResponse.json({ received: true, duplicate: !inserted });
}
