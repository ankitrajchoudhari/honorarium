import { describe, expect, it } from "vitest";
import { maskIdentity, normalizeAnswer, normalizeEmail, normalizePhone, parseNumber, payoutIdentity } from "@/engine/normalize";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Jane.Doe@Example.ORG ")).toBe("jane.doe@example.org");
  });

  it("treats Gmail dot, +tag and googlemail variants as the same inbox", () => {
    const variants = ["r.oy.k@gmail.com", "roy.k+1@gmail.com", "ROYK@googlemail.com", "royk+study@GMAIL.com"];
    expect(new Set(variants.map(normalizeEmail))).toEqual(new Set(["royk@gmail.com"]));
  });

  it("keeps dots and plus tags for non-Gmail domains", () => {
    expect(normalizeEmail("a.b+c@uni.edu")).toBe("a.b+c@uni.edu");
  });

  it("rejects values that are not email addresses", () => {
    expect(normalizeEmail("not an email")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("+tag@gmail.com")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("adds the US country code to 10-digit numbers", () => {
    expect(normalizePhone("(408) 555-0123")).toBe("14085550123");
  });

  it("keeps international numbers with a plus", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("442079460958");
  });

  it("rejects numbers that cannot be valid", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("call me")).toBeNull();
    expect(normalizePhone("1234567890123456")).toBeNull();
  });
});

describe("payoutIdentity", () => {
  it("prefers email and keeps the raw value for paying", () => {
    expect(payoutIdentity(" Roy.K@gmail.com ", "4085550123")).toEqual({ type: "email", raw: "Roy.K@gmail.com", normalized: "royk@gmail.com" });
  });

  it("falls back to phone and marks unusable values", () => {
    expect(payoutIdentity("", "555")).toEqual({ type: "phone", raw: "555", normalized: null });
    expect(payoutIdentity(undefined, undefined)).toBeNull();
  });
});

describe("helpers", () => {
  it("compares answers without case or spacing differences", () => {
    expect(normalizeAnswer("  Strongly   DISAGREE ")).toBe(normalizeAnswer("strongly disagree"));
  });

  it("parses only plain numbers", () => {
    expect(parseNumber(" 19 ")).toBe(19);
    expect(parseNumber("1,200")).toBe(1200);
    expect(parseNumber("nineteen")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("masks all but the last four characters", () => {
    expect(maskIdentity("jane@example.org")).toBe("••••••••.org");
    expect(maskIdentity("abc")).toBe("••••");
  });
});
