import type { Bucket } from "@/ledger/buckets";

/** PayPal item statuses (verified against the Payouts OpenAPI spec) plus our own NEW and NOT_SENT. */
export const ITEM_STATUSES = ["NEW", "PENDING", "ONHOLD", "UNCLAIMED", "SUCCESS", "FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "NOT_SENT"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

const TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  NEW: ["PENDING", "ONHOLD", "UNCLAIMED", "SUCCESS", "FAILED", "BLOCKED", "RETURNED", "NOT_SENT"],
  PENDING: ["ONHOLD", "UNCLAIMED", "SUCCESS", "FAILED", "BLOCKED", "RETURNED"],
  ONHOLD: ["PENDING", "UNCLAIMED", "SUCCESS", "FAILED", "BLOCKED", "RETURNED"],
  UNCLAIMED: ["SUCCESS", "RETURNED"],
  BLOCKED: ["RETURNED", "FAILED"],
  SUCCESS: ["REFUNDED", "REVERSED", "RETURNED"],
  FAILED: [],
  RETURNED: [],
  REFUNDED: [],
  REVERSED: [],
  NOT_SENT: [],
};

/** Applies a status only if it moves forward; late or duplicate events (e.g. PENDING after SUCCESS) are ignored. */
export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isFinal(status: ItemStatus): boolean {
  return TRANSITIONS[status].length === 0 || status === "SUCCESS";
}

/**
 * Where an item's money sits in the ledger. Money returns to "unallocated" only when PayPal confirms it is back
 * (FAILED means it was never taken). BLOCKED stays in flight until PayPal reports the return.
 */
export function bucketFor(status: ItemStatus): Bucket {
  switch (status) {
    case "NEW":
    case "PENDING":
    case "ONHOLD":
    case "BLOCKED":
      return "in_flight";
    case "UNCLAIMED":
      return "unclaimed";
    case "SUCCESS":
      return "paid";
    case "FAILED":
    case "RETURNED":
    case "REFUNDED":
    case "REVERSED":
    case "NOT_SENT":
      return "unallocated";
  }
}

export function parseItemStatus(value: unknown): ItemStatus | null {
  return typeof value === "string" && (ITEM_STATUSES as readonly string[]).includes(value) && value !== "NEW" && value !== "NOT_SENT" ? (value as ItemStatus) : null;
}

/** Item webhook event names (verified) → the status they report. CANCELED means the money went back to the sender. */
export const ITEM_EVENT_STATUS: Record<string, ItemStatus> = {
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "SUCCESS",
  "PAYMENT.PAYOUTS-ITEM.FAILED": "FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED": "RETURNED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED": "RETURNED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": "BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED": "REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.HELD": "ONHOLD",
};

export const BATCH_EVENTS = ["PAYMENT.PAYOUTSBATCH.DENIED", "PAYMENT.PAYOUTSBATCH.PROCESSING", "PAYMENT.PAYOUTSBATCH.SUCCESS"] as const;

/** PayPal returns unclaimed payouts after 30 days (Payouts API, transaction_status UNCLAIMED). */
export const UNCLAIMED_RETURN_DAYS = 30;

export function unclaimedDaysLeft(unclaimedSince: Date, now: Date = new Date()): number {
  const elapsed = Math.floor((now.getTime() - unclaimedSince.getTime()) / 86_400_000);
  return Math.max(0, UNCLAIMED_RETURN_DAYS - elapsed);
}

const PLAIN_REASONS: Record<string, string> = {
  RECEIVER_UNREGISTERED: "The recipient has no PayPal account yet. PayPal emailed them a link to claim it.",
  RECEIVER_UNCONFIRMED: "The recipient's PayPal account is not confirmed.",
  RECEIVER_ACCOUNT_LOCKED: "The recipient's PayPal account is locked.",
  RECEIVER_COUNTRY_NOT_ALLOWED: "PayPal cannot pay recipients in this country.",
  RECEIVER_ACCOUNT_LIMITATION: "The recipient's PayPal account has a limitation.",
  RECEIVER_YOUTH_ACCOUNT: "The recipient has a youth account that cannot receive this payment.",
  RECEIVING_LIMIT_EXCEEDED: "The recipient has reached their receiving limit.",
  INSUFFICIENT_FUNDS: "The sending account does not have enough money.",
  RECEIVER_REFUSED: "The recipient refused the payment.",
  REGULATORY_BLOCKED: "PayPal blocked this payment for regulatory reasons.",
  RISK_DECLINE: "PayPal declined this payment after a risk review.",
  DUPLICATE_ITEM: "PayPal saw this as a duplicate of an earlier item.",
};

export function plainReason(code: string | null | undefined, fallback?: string | null): string {
  if (code && PLAIN_REASONS[code]) {
    return PLAIN_REASONS[code];
  }
  return fallback ?? (code ? `PayPal reported ${code}.` : "PayPal did not give a reason.");
}
