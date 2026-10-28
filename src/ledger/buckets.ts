export const BUCKETS = ["unallocated", "allocated_pay", "held_review", "in_flight", "paid", "unclaimed", "withheld"] as const;
export type Bucket = (typeof BUCKETS)[number];
/** "budget" is the outside source the study budget is funded from; it is not part of the balance. */
export type LedgerBucket = Bucket | "budget";

export type Balances = Record<Bucket, number>;

export interface LedgerMove {
  from: LedgerBucket;
  to: LedgerBucket;
  amountCents: number;
}

export const BUCKET_LABELS: Record<Bucket, string> = {
  unallocated: "Unallocated",
  allocated_pay: "Allocated to pay",
  held_review: "Held for review",
  in_flight: "In flight",
  paid: "Paid",
  unclaimed: "Unclaimed",
  withheld: "Withheld",
};

export function emptyBalances(): Balances {
  return { unallocated: 0, allocated_pay: 0, held_review: 0, in_flight: 0, paid: 0, unclaimed: 0, withheld: 0 };
}

export function applyMoves(start: Balances, moves: readonly LedgerMove[]): Balances {
  const result = { ...start };
  for (const move of moves) {
    if (!Number.isSafeInteger(move.amountCents) || move.amountCents <= 0) {
      throw new Error(`Ledger amounts must be positive whole cents, got ${move.amountCents}.`);
    }
    if (move.from === move.to) {
      throw new Error("A ledger move needs two different buckets.");
    }
    if (move.from !== "budget") {
      result[move.from] -= move.amountCents;
    }
    if (move.to !== "budget") {
      result[move.to] += move.amountCents;
    }
  }
  return result;
}

export type InvariantResult = { balanced: true; total: number } | { balanced: false; total: number; difference: number; negative: Bucket[] };

/** budget = unallocated + allocated_pay + held_review + in_flight + paid + unclaimed + withheld, and no bucket is negative. */
export function checkInvariant(budgetCents: number, balances: Balances): InvariantResult {
  const total = BUCKETS.reduce((sum, name) => sum + balances[name], 0);
  const negative = BUCKETS.filter((name) => balances[name] < 0);
  if (total === budgetCents && negative.length === 0) {
    return { balanced: true, total };
  }
  return { balanced: false, total, difference: total - budgetCents, negative };
}
