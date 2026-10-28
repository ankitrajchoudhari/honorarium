import { describe, expect, it } from "vitest";
import { binSubmissions, checkLabel } from "@/engine/insights";

describe("checkLabel", () => {
  const types = new Map([["r1", "min_duration" as const]]);

  it("names locked rules by id and type", () => {
    expect(checkLabel("r1", types)).toBe("R1 · Finished too fast");
  });

  it("names similarity, AI and system checks", () => {
    expect(checkLabel("similarity:Q3_KeepsAwake", types)).toBe("Near-identical answers (Q3)");
    expect(checkLabel("ai:Q3_KeepsAwake", types)).toBe("AI flag on Q3");
    expect(checkLabel("system:payout_identity", types)).toBe("Unusable payout identity");
  });
});

describe("binSubmissions", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 27, 10, minute));

  it("counts every dated submission once, by decision", () => {
    const rows = [
      { at: at(0), decision: "pay" as const },
      { at: at(0), decision: "dont_pay" as const },
      { at: at(5), decision: "hold" as const },
      { at: null, decision: "pay" as const },
    ];
    const bins = binSubmissions(rows);
    const totals = bins.reduce((sum, bin) => ({ pay: sum.pay + bin.pay, hold: sum.hold + bin.hold, dontPay: sum.dontPay + bin.dontPay }), { pay: 0, hold: 0, dontPay: 0 });
    expect(totals).toEqual({ pay: 1, hold: 1, dontPay: 1 });
    expect(bins[0]?.label).toBe("10:00");
  });

  it("never makes more bins than asked for", () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ at: new Date(Date.UTC(2026, 9, 27) + index * 7_919_000), decision: "pay" as const }));
    expect(binSubmissions(rows, 48).length).toBeLessThanOrEqual(48);
  });

  it("returns nothing when no submission has a time", () => {
    expect(binSubmissions([{ at: null, decision: "pay" }])).toEqual([]);
  });
});
