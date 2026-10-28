import { describe, expect, it } from "vitest";
import { hashCanonical, canonicalJson } from "@/engine/canonical";
import { centsToDecimalString, formatCents, parseDollarsToCents, sumCents } from "@/lib/money";

describe("money", () => {
  it("formats cents for display", () => {
    expect(formatCents(150_000)).toBe("$1,500.00");
    expect(formatCents(1_005)).toBe("$10.05");
    expect(formatCents(-250)).toBe("-$2.50");
  });

  it("produces PayPal decimal strings without floating point", () => {
    expect(centsToDecimalString(1_000)).toBe("10.00");
    expect(centsToDecimalString(7)).toBe("0.07");
    expect(() => centsToDecimalString(-1)).toThrow();
  });

  it("parses user input into cents exactly", () => {
    expect(parseDollarsToCents("1,500")).toBe(150_000);
    expect(parseDollarsToCents("$10.5")).toBe(1_050);
    expect(parseDollarsToCents("0.1")).toBe(10);
    expect(parseDollarsToCents("10.555")).toBeNull();
    expect(parseDollarsToCents("ten")).toBeNull();
  });

  it("sums exactly where floating point would drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumCents([10, 20])).toBe(30);
    expect(sumCents(Array.from({ length: 1000 }, () => 1))).toBe(1000);
    expect(() => sumCents([1.5])).toThrow();
  });
});

describe("canonical JSON", () => {
  it("hashes equal content the same regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: null } })).toBe('{"a":{"c":null,"d":[1,2]},"b":1}');
    expect(hashCanonical({ x: 1, y: 2 })).toBe(hashCanonical({ y: 2, x: 1 }));
    expect(hashCanonical({ x: 1 })).not.toBe(hashCanonical({ x: 2 }));
  });
});
