import { describe, expect, it } from "vitest";
import { runPreflight, type PayoutCandidate } from "@/payouts/preflight";

const candidate = (ref: string, overrides: Partial<PayoutCandidate> = {}): PayoutCandidate => ({
  respondentId: ref,
  ref,
  identityType: "email",
  identityRaw: `${ref}@example.org`,
  identityNormalized: `${ref.toLowerCase()}@example.org`,
  submittedAt: new Date(Date.UTC(2026, 9, 14, 12, 0, Number(ref.slice(2)))),
  reservedCents: 1_000,
  hasLiveItem: false,
  failedIdentities: [],
  ...overrides,
});

const context = { amountCents: 1_000, studyCurrency: "USD", payoutCurrency: "USD", ledgerBalanced: true, allocatedPayCents: 3_000 };

describe("runPreflight", () => {
  it("pays funded respondents with valid identities and passes every check", () => {
    const result = runPreflight([candidate("R-01"), candidate("R-02"), candidate("R-03")], context);
    expect(result.eligible.map((entry) => entry.ref)).toEqual(["R-01", "R-02", "R-03"]);
    expect(result.totalCents).toBe(3_000);
    expect(result.ready).toBe(true);
  });

  it("never includes someone already in a live or successful payout", () => {
    const result = runPreflight([candidate("R-01", { hasLiveItem: true }), candidate("R-02")], context);
    expect(result.eligible.map((entry) => entry.ref)).toEqual(["R-02"]);
  });

  it("skips duplicate identities, missing identities, unfunded people and uncorrected failures with reasons", () => {
    const result = runPreflight(
      [
        candidate("R-01", { identityNormalized: "same@example.org" }),
        candidate("R-02", { identityNormalized: "same@example.org" }),
        candidate("R-03", { identityNormalized: null }),
        candidate("R-04", { reservedCents: 0 }),
        candidate("R-05", { failedIdentities: ["r-05@example.org"] }),
      ],
      { ...context, allocatedPayCents: 5_000 },
    );
    expect(result.eligible.map((entry) => entry.ref)).toEqual(["R-01"]);
    expect(result.skipped).toEqual([
      { ref: "R-02", reason: "Same payout identity as R-01 in this batch" },
      { ref: "R-03", reason: "No usable payout email or phone" },
      { ref: "R-04", reason: "Not covered by the remaining budget" },
      { ref: "R-05", reason: "A payout to this address failed; correct the address before retrying" },
    ]);
  });

  it("allows a retry once a failed address was corrected", () => {
    const result = runPreflight([candidate("R-05", { failedIdentities: ["typo@example.org"] })], context);
    expect(result.eligible).toHaveLength(1);
  });

  it("blocks payouts when the ledger is out of balance, the total exceeds reservations or the currency differs", () => {
    expect(runPreflight([candidate("R-01")], { ...context, ledgerBalanced: false }).ready).toBe(false);
    expect(runPreflight([candidate("R-01"), candidate("R-02")], { ...context, allocatedPayCents: 1_000 }).ready).toBe(false);
    expect(runPreflight([candidate("R-01")], { ...context, payoutCurrency: "EUR" }).ready).toBe(false);
    expect(runPreflight([], context).ready).toBe(false);
  });
});
