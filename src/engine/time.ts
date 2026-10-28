export type DateOrder = "MDY" | "DMY";

export interface TimeParseOptions {
  /** IANA zone used for timestamps that carry no offset. Null means none was chosen yet. */
  timezone: string | null;
  dateOrder: DateOrder;
}

export type TimeParseResult =
  | { ok: true; date: Date; hadOffset: boolean }
  | { ok: false; reason: "empty" | "unparseable" | "needs_timezone" };

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;
const YMD_TIME = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const SLASH_TIME = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i;
const EXCEL_SERIAL = /^\d{4,6}(\.\d+)?$/;

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function offsetMs(utcMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Converts a wall-clock time in an IANA zone to a UTC instant (handles DST). */
export function zonedToUtc(fields: { year: number; month: number; day: number; hour: number; minute: number; second: number }, zone: string): Date {
  const wall = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
  const first = wall - offsetMs(wall, zone);
  const second = wall - offsetMs(first, zone);
  return new Date(second);
}

function validCalendar(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function to24h(hour: number, meridiem: string | undefined): number | null {
  if (meridiem === undefined) {
    return hour <= 23 ? hour : null;
  }
  if (hour < 1 || hour > 12) {
    return null;
  }
  const pm = meridiem.toLowerCase() === "pm";
  return (hour % 12) + (pm ? 12 : 0);
}

export function parseTimestamp(raw: string, options: TimeParseOptions): TimeParseResult {
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (ISO_WITH_OFFSET.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? { ok: false, reason: "unparseable" } : { ok: true, date, hadOffset: true };
  }

  let fields: { year: number; month: number; day: number; hour: number; minute: number; second: number } | null = null;
  const ymd = YMD_TIME.exec(value);
  const slash = SLASH_TIME.exec(value);
  if (ymd) {
    fields = {
      year: Number(ymd[1]),
      month: Number(ymd[2]),
      day: Number(ymd[3]),
      hour: Number(ymd[4] ?? "0"),
      minute: Number(ymd[5] ?? "0"),
      second: Number(ymd[6] ?? "0"),
    };
  } else if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const hour = to24h(Number(slash[4] ?? "0"), slash[7]);
    if (hour === null) {
      return { ok: false, reason: "unparseable" };
    }
    fields = {
      year: Number(slash[3]),
      month: options.dateOrder === "MDY" ? first : second,
      day: options.dateOrder === "MDY" ? second : first,
      hour,
      minute: Number(slash[5] ?? "0"),
      second: Number(slash[6] ?? "0"),
    };
  } else if (EXCEL_SERIAL.test(value)) {
    const serial = Number(value);
    const wall = new Date(EXCEL_EPOCH_MS + Math.round(serial * DAY_MS));
    fields = {
      year: wall.getUTCFullYear(),
      month: wall.getUTCMonth() + 1,
      day: wall.getUTCDate(),
      hour: wall.getUTCHours(),
      minute: wall.getUTCMinutes(),
      second: wall.getUTCSeconds(),
    };
  }

  if (!fields || !validCalendar(fields.year, fields.month, fields.day) || fields.minute > 59 || fields.second > 59 || fields.hour > 23) {
    return { ok: false, reason: "unparseable" };
  }
  if (options.timezone === null) {
    return { ok: false, reason: "needs_timezone" };
  }
  return { ok: true, date: zonedToUtc(fields, options.timezone), hadOffset: false };
}

/** Parses a calendar date (no time zone involved), e.g. a date of birth. */
export function parseCalendarDate(raw: string, dateOrder: DateOrder): CalendarDate | null {
  const value = raw.trim();
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(value);
  let result: CalendarDate | null = null;
  if (ymd) {
    result = { year: Number(ymd[1]), month: Number(ymd[2]), day: Number(ymd[3]) };
  } else if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    result = {
      year: Number(slash[3]),
      month: dateOrder === "MDY" ? first : second,
      day: dateOrder === "MDY" ? second : first,
    };
  } else if (/^\d{4,5}$/.test(value)) {
    const date = new Date(EXCEL_EPOCH_MS + Number(value) * DAY_MS);
    result = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }
  if (!result || !validCalendar(result.year, result.month, result.day)) {
    return null;
  }
  return result;
}

/** Whole years between a birth date and a reference date. */
export function ageOn(birth: CalendarDate, on: CalendarDate): number {
  let age = on.year - birth.year;
  if (on.month < birth.month || (on.month === birth.month && on.day < birth.day)) {
    age -= 1;
  }
  return age;
}

export function calendarDateUtc(date: Date): CalendarDate {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
