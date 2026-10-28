import { describe, expect, it } from "vitest";
import { applyMoves, checkInvariant, emptyBalances, type LedgerMove } from "@/ledger/buckets";
import { planReservations, type ReservationState } from "@/ledger/reservations";

const BUDGET = 150_000;
const funded = () => applyMoves(emptyBalances(), [{ from: "budget", to: "unallocated", amountCents: BUDGET }]);

describe("ledger buckets", () => {
  it("funding the budget balances", () => {
    expect(checkInvariant(BUDGET, funded())).toEqual({ balanced: true, total: BUDGET });
  });

  it("every bucket transition keeps the books balanced", () => {
    const path: LedgerMove[] = [
      { from: "unallocated", to: "held_review", amountCents: 1_000 },
      { from: "held_review", to: "allocated_pay", amountCents: 1_000 },
      { from: "allocated_pay", to: "in_flight", amountCents: 1_000 },
      { from: "in_flight", to: "unclaimed", amountCents: 1_000 },
      { from: "unclaimed", to: "paid", amountCents: 1_000 },
      { from: "unallocated", to: "allocated_pay", amountCents: 1_000 },
      { from: "allocated_pay", to: "in_flight", amountCents: 1_000 },
      { from: "in_flight", to: "unallocated", amountCents: 1_000 },
    ];
    let balances = funded();
    for (const move of path) {
      balances = applyMoves(balances, [move]);
      expect(checkInvariant(BUDGET, balances).balanced).toBe(true);
    }
    expect(balances.paid).toBe(1_000);
    expect(balances.unallocated).toBe(BUDGET - 1_000);
  });

  it("reports drift and negative buckets instead of correcting them", () => {
    const drifted = { ...funded(), paid: 500 };
    expect(checkInvariant(BUDGET, drifted)).toEqual({ balanced: false, total: BUDGET + 500, difference: 500, negative: [] });
    const overdrawn = applyMoves(funded(), [{ from: "in_flight", to: "paid", amountCents: 100 }]);
    expect(checkInvariant(BUDGET, overdrawn)).toMatchObject({ balanced: false, negative: ["in_flight"] });
  });

  it("rejects fractional, zero and self moves", () => {
    expect(() => applyMoves(funded(), [{ from: "unallocated", to: "paid", amountCents: 10.5 }])).toThrow();
    expect(() => applyMoves(funded(), [{ from: "unallocated", to: "paid", amountCents: 0 }])).toThrow();
    expect(() => applyMoves(funded(), [{ from: "paid", to: "paid", amountCents: 1 }])).toThrow();
  });
});

describe("planReservations", () => {
  const state = (respondentId: string, decision: ReservationState["decision"], reserved: ReservationState["reserved"] = null, hasLivePayout = false): ReservationState => ({
    respondentId,
    decision,
    reserved,
    hasLivePayout,
  });

  it("reserves money for pay and hold, nothing for don't pay", () => {
    const plan = planReservations([state("a", "pay"), state("b", "hold"), state("c", "dont_pay")], 1_000, 10_000);
    expect(plan.moves.map((move) => [move.respondentId, move.from, move.to])).toEqual([
      ["a", "unallocated", "allocated_pay"],
      ["b", "unallocated", "held_review"],
    ]);
    expect(plan.unfunded).toEqual([]);
  });

  it("moves held money to pay after review and releases it on don't pay", () => {
    const plan = planReservations([state("a", "pay", "held_review"), state("b", "dont_pay", "held_review")], 1_000, 0);
    expect(plan.moves.map((move) => [move.respondentId, move.from, move.to])).toEqual([
      ["a", "held_review", "allocated_pay"],
      ["b", "held_review", "unallocated"],
    ]);
  });

  it("never overspends: funds earliest first, uses released money, reports the rest", () => {
    const plan = planReservations([state("early", "pay"), state("released", "dont_pay", "held_review"), state("late", "pay"), state("later", "hold")], 1_000, 1_000);
    expect(plan.moves.map((move) => move.respondentId)).toEqual(["released", "early", "late"]);
    expect(plan.unfunded).toEqual(["later"]);
    const total = plan.moves.filter((move) => move.from === "unallocated").reduce((sum, move) => sum + move.amountCents, 0);
    expect(total).toBe(2_000);
  });

  it("leaves respondents with a live payout alone and is idempotent", () => {
    expect(planReservations([state("a", "pay", null, true), state("b", "pay", "allocated_pay")], 1_000, 0)).toEqual({ moves: [], unfunded: [] });
  });
});
