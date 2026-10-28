import { describe, expect, it } from "vitest";
import { bucketFor, canTransition, ITEM_EVENT_STATUS, parseItemStatus, plainReason, unclaimedDaysLeft, type ItemStatus } from "@/paypal/state";

describe("payout item state machine", () => {
  it("moves forward through the normal paths", () => {
    expect(canTransition("NEW", "PENDING")).toBe(true);
    expect(canTransition("PENDING", "UNCLAIMED")).toBe(true);
    expect(canTransition("UNCLAIMED", "SUCCESS")).toBe(true);
    expect(canTransition("UNCLAIMED", "RETURNED")).toBe(true);
    expect(canTransition("SUCCESS", "REFUNDED")).toBe(true);
  });

  it("ignores late or replayed events that would move backwards", () => {
    expect(canTransition("SUCCESS", "PENDING")).toBe(false);
    expect(canTransition("SUCCESS", "UNCLAIMED")).toBe(false);
    expect(canTransition("UNCLAIMED", "PENDING")).toBe(false);
    expect(canTransition("RETURNED", "SUCCESS")).toBe(false);
    expect(canTransition("FAILED", "SUCCESS")).toBe(false);
    expect(canTransition("SUCCESS", "SUCCESS")).toBe(false);
  });

  it("applies an out-of-order sequence to the right final state", () => {
    const events: ItemStatus[] = ["UNCLAIMED", "PENDING", "SUCCESS", "PENDING", "UNCLAIMED"];
    let state: ItemStatus = "NEW";
    for (const event of events) {
      if (canTransition(state, event)) {
        state = event;
      }
    }
    expect(state).toBe("SUCCESS");
  });

  it("maps statuses to ledger buckets, returning money only when PayPal confirms", () => {
    expect(bucketFor("PENDING")).toBe("in_flight");
    expect(bucketFor("BLOCKED")).toBe("in_flight");
    expect(bucketFor("UNCLAIMED")).toBe("unclaimed");
    expect(bucketFor("SUCCESS")).toBe("paid");
    expect(bucketFor("RETURNED")).toBe("unallocated");
    expect(bucketFor("FAILED")).toBe("unallocated");
  });

  it("maps verified webhook event names, treating CANCELED as returned money", () => {
    expect(ITEM_EVENT_STATUS["PAYMENT.PAYOUTS-ITEM.SUCCEEDED"]).toBe("SUCCESS");
    expect(ITEM_EVENT_STATUS["PAYMENT.PAYOUTS-ITEM.CANCELED"]).toBe("RETURNED");
    expect(ITEM_EVENT_STATUS["PAYMENT.PAYOUTS-ITEM.HELD"]).toBe("ONHOLD");
  });

  it("parses only real PayPal statuses", () => {
    expect(parseItemStatus("UNCLAIMED")).toBe("UNCLAIMED");
    expect(parseItemStatus("NEW")).toBeNull();
    expect(parseItemStatus("MADE_UP")).toBeNull();
  });

  it("counts down the 30-day unclaimed period", () => {
    const since = new Date("2026-10-01T00:00:00Z");
    expect(unclaimedDaysLeft(since, new Date("2026-10-04T12:00:00Z"))).toBe(27);
    expect(unclaimedDaysLeft(since, new Date("2026-12-01T00:00:00Z"))).toBe(0);
  });

  it("explains PayPal reasons in plain English", () => {
    expect(plainReason("RECEIVER_UNREGISTERED")).toMatch(/no PayPal account/);
    expect(plainReason("SOMETHING_NEW")).toBe("PayPal reported SOMETHING_NEW.");
  });
});
