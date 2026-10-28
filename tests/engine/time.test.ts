import { describe, expect, it } from "vitest";
import { ageOn, isValidTimeZone, parseCalendarDate, parseTimestamp, zonedToUtc } from "@/engine/time";

const MDY_NO_ZONE = { timezone: null, dateOrder: "MDY" } as const;

describe("parseTimestamp", () => {
  it("accepts ISO timestamps with an offset without asking for a zone", () => {
    const result = parseTimestamp("2026-10-01T09:15:00+05:30", MDY_NO_ZONE);
    expect(result).toEqual({ ok: true, date: new Date("2026-10-01T03:45:00Z"), hadOffset: true });
  });

  it("never guesses a zone for timestamps without one", () => {
    expect(parseTimestamp("2026-10-01 09:15:00", MDY_NO_ZONE)).toEqual({ ok: false, reason: "needs_timezone" });
    expect(parseTimestamp("10/1/2026 9:15", MDY_NO_ZONE)).toEqual({ ok: false, reason: "needs_timezone" });
  });

  it("converts wall-clock times in the chosen zone, including DST", () => {
    const summer = parseTimestamp("2026-07-01 12:00", { timezone: "America/New_York", dateOrder: "MDY" });
    const winter = parseTimestamp("2026-12-01 12:00", { timezone: "America/New_York", dateOrder: "MDY" });
    expect(summer.ok && summer.date.toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(winter.ok && winter.date.toISOString()).toBe("2026-12-01T17:00:00.000Z");
  });

  it("reads US and day-first slash dates with AM/PM", () => {
    const us = parseTimestamp("10/2/2026 3:05:09 PM", { timezone: "UTC", dateOrder: "MDY" });
    const dayFirst = parseTimestamp("10/2/2026 15:05:09", { timezone: "UTC", dateOrder: "DMY" });
    expect(us.ok && us.date.toISOString()).toBe("2026-10-02T15:05:09.000Z");
    expect(dayFirst.ok && dayFirst.date.toISOString()).toBe("2026-02-10T15:05:09.000Z");
  });

  it("reads Excel serial date-times", () => {
    const result = parseTimestamp("46296.5", { timezone: "UTC", dateOrder: "MDY" });
    expect(result.ok && result.date.toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });

  it("rejects impossible dates and empty values", () => {
    expect(parseTimestamp("2026-02-30 10:00", { timezone: "UTC", dateOrder: "MDY" })).toEqual({ ok: false, reason: "unparseable" });
    expect(parseTimestamp("13/13/2026", { timezone: "UTC", dateOrder: "MDY" })).toEqual({ ok: false, reason: "unparseable" });
    expect(parseTimestamp("   ", MDY_NO_ZONE)).toEqual({ ok: false, reason: "empty" });
  });
});

describe("calendar helpers", () => {
  it("parses dates of birth in several formats", () => {
    expect(parseCalendarDate("2006-03-14", "MDY")).toEqual({ year: 2006, month: 3, day: 14 });
    expect(parseCalendarDate("14/03/2006", "DMY")).toEqual({ year: 2006, month: 3, day: 14 });
    expect(parseCalendarDate("38790", "MDY")).toEqual({ year: 2006, month: 3, day: 14 });
    expect(parseCalendarDate("not a date", "MDY")).toBeNull();
  });

  it("computes whole years of age", () => {
    expect(ageOn({ year: 2006, month: 10, day: 2 }, { year: 2026, month: 10, day: 1 })).toBe(19);
    expect(ageOn({ year: 2006, month: 10, day: 1 }, { year: 2026, month: 10, day: 1 })).toBe(20);
  });

  it("validates zone names and converts across zones", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(zonedToUtc({ year: 2026, month: 10, day: 1, hour: 10, minute: 0, second: 0 }, "Asia/Kolkata").toISOString()).toBe("2026-10-01T04:30:00.000Z");
  });
});
