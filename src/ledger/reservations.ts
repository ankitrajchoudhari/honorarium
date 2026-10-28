import type { Decision } from "@/engine/types";
import type { LedgerMove } from "@/ledger/buckets";

export type ReservationBucket = "allocated_pay" | "held_review";

export interface ReservationState {
  respondentId: string;
  decision: Decision | null;
  /** Where this respondent's money currently sits, if reserved. */
  reserved: ReservationBucket | null;
  /** A payout item that still holds this respondent's money (sent, unclaimed, paid). */
  hasLivePayout: boolean;
}

export interface PlannedMove extends LedgerMove {
  respondentId: string;
  reason: string;
}

export interface ReservationPlan {
  moves: PlannedMove[];
  /** Respondents who should have money reserved but the budget has none left. */
  unfunded: string[];
}

const DESIRED: Record<Decision, ReservationBucket | null> = { pay: "allocated_pay", hold: "held_review", dont_pay: null };
const REASON: Record<ReservationBucket, string> = { allocated_pay: "Decision: pay", held_review: "Held for review" };

/**
 * Brings each respondent's reservation in line with their current decision.
 * Releases first so freed money can fund others; then funds in the given order (earliest submission first).
 */
export function planReservations(states: readonly ReservationState[], amountCents: number, unallocatedCents: number): ReservationPlan {
  const moves: PlannedMove[] = [];
  const toFund: ReservationState[] = [];
  let available = unallocatedCents;

  for (const state of states) {
    if (state.hasLivePayout) {
      continue;
    }
    const desired = state.decision === null ? null : DESIRED[state.decision];
    if (state.reserved === desired) {
      continue;
    }
    if (state.reserved !== null && desired !== null) {
      moves.push({ respondentId: state.respondentId, from: state.reserved, to: desired, amountCents, reason: REASON[desired] });
    } else if (state.reserved !== null) {
      moves.push({ respondentId: state.respondentId, from: state.reserved, to: "unallocated", amountCents, reason: "Decision: don't pay · reservation released" });
      available += amountCents;
    } else {
      toFund.push(state);
    }
  }

  const unfunded: string[] = [];
  for (const state of toFund) {
    const desired = DESIRED[state.decision as Decision];
    if (desired === null) {
      continue;
    }
    if (available >= amountCents) {
      moves.push({ respondentId: state.respondentId, from: "unallocated", to: desired, amountCents, reason: REASON[desired] });
      available -= amountCents;
    } else {
      unfunded.push(state.respondentId);
    }
  }
  return { moves, unfunded };
}
