import { MAX_ITEMS_PER_BATCH } from "@/paypal/payouts";

export interface PayoutCandidate {
  respondentId: string;
  ref: string;
  identityType: "email" | "phone" | null;
  identityRaw: string | null;
  identityNormalized: string | null;
  submittedAt: Date | null;
  /** Money reserved in allocated_pay for this respondent. */
  reservedCents: number;
  hasLiveItem: boolean;
  /** Normalized identities a previous payout to this respondent failed on. */
  failedIdentities: string[];
}

export interface PreflightCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface PreflightResult {
  eligible: PayoutCandidate[];
  skipped: { ref: string; reason: string }[];
  checks: PreflightCheck[];
  totalCents: number;
  batchCount: number;
  ready: boolean;
}

export interface PreflightContext {
  amountCents: number;
  studyCurrency: string;
  payoutCurrency: string;
  ledgerBalanced: boolean;
  allocatedPayCents: number;
}

/** Decides who can be paid now and runs every pre-flight check. Pure: the same inputs give the same answer. */
export function runPreflight(candidates: readonly PayoutCandidate[], context: PreflightContext): PreflightResult {
  const skipped: { ref: string; reason: string }[] = [];
  const eligible: PayoutCandidate[] = [];
  const seen = new Map<string, string>();
  const ordered = [...candidates].sort((a, b) => (a.submittedAt?.getTime() ?? Infinity) - (b.submittedAt?.getTime() ?? Infinity) || a.ref.localeCompare(b.ref));

  for (const candidate of ordered) {
    if (candidate.hasLiveItem) {
      continue;
    }
    if (!candidate.identityNormalized || !candidate.identityRaw || !candidate.identityType) {
      skipped.push({ ref: candidate.ref, reason: "No usable payout email or phone" });
      continue;
    }
    if (candidate.failedIdentities.includes(candidate.identityNormalized)) {
      skipped.push({ ref: candidate.ref, reason: "A payout to this address failed; correct the address before retrying" });
      continue;
    }
    if (candidate.reservedCents < context.amountCents) {
      skipped.push({ ref: candidate.ref, reason: "Not covered by the remaining budget" });
      continue;
    }
    const earlier = seen.get(candidate.identityNormalized);
    if (earlier) {
      skipped.push({ ref: candidate.ref, reason: `Same payout identity as ${earlier} in this batch` });
      continue;
    }
    seen.set(candidate.identityNormalized, candidate.ref);
    eligible.push(candidate);
  }

  const totalCents = eligible.length * context.amountCents;
  const batchCount = Math.ceil(eligible.length / MAX_ITEMS_PER_BATCH);
  const checks: PreflightCheck[] = [
    { label: "Ledger balanced", ok: context.ledgerBalanced, detail: context.ledgerBalanced ? "Every cent is accounted for." : "Payouts are blocked until the ledger balances." },
    {
      label: "Total within reserved budget",
      ok: totalCents <= context.allocatedPayCents,
      detail: `${eligible.length} × ${context.amountCents} cents = ${totalCents} cents; reserved for payment: ${context.allocatedPayCents} cents.`,
    },
    { label: "Every recipient has a valid payout identity", ok: true, detail: `${skipped.filter((entry) => entry.reason.startsWith("No usable")).length} without one are left out.` },
    { label: "No duplicate payout identity in the batch", ok: new Set(eligible.map((entry) => entry.identityNormalized)).size === eligible.length, detail: "Normalized identities are unique." },
    {
      label: "Within PayPal's batch size",
      ok: true,
      detail: batchCount <= 1 ? `${eligible.length} of at most ${MAX_ITEMS_PER_BATCH.toLocaleString("en-US")} items.` : `Split into ${batchCount} batches of at most ${MAX_ITEMS_PER_BATCH.toLocaleString("en-US")}.`,
    },
    {
      label: "Currency matches the study",
      ok: context.studyCurrency === context.payoutCurrency,
      detail: `Study currency ${context.studyCurrency}; payout currency ${context.payoutCurrency}.`,
    },
  ];
  return { eligible, skipped, checks, totalCents, batchCount, ready: eligible.length > 0 && checks.every((check) => check.ok) };
}
