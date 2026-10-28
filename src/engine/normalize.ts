import type { PayoutIdentity } from "@/engine/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Canonical form used to detect the same inbox written differently.
 * Gmail ignores dots and "+tags" in the local part, and googlemail.com is the same service.
 * Returns null for values that are not usable email addresses.
 */
export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(trimmed)) {
    return null;
  }
  const at = trimmed.lastIndexOf("@");
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    domain = "gmail.com";
    local = local.split("+")[0]?.replaceAll(".", "") ?? "";
    if (local.length === 0) {
      return null;
    }
  }
  return `${local}@${domain}`;
}

/**
 * Digits with country code. A 10-digit number is read as a US number (the only payout country this app supports).
 * Returns null when the result cannot be a valid international number.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || /[a-z]/i.test(trimmed)) {
    return null;
  }
  let digits = trimmed.replace(/\D/g, "");
  if (!trimmed.startsWith("+") && digits.length === 10) {
    digits = `1${digits}`;
  }
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) {
    return null;
  }
  return digits;
}

export function payoutIdentity(email: string | undefined, phone: string | undefined): PayoutIdentity | null {
  if (email !== undefined && email.trim().length > 0) {
    return { type: "email", raw: email.trim(), normalized: normalizeEmail(email) };
  }
  if (phone !== undefined && phone.trim().length > 0) {
    return { type: "phone", raw: phone.trim(), normalized: normalizePhone(phone) };
  }
  return null;
}

/** For answer comparisons: case-insensitive, whitespace collapsed. */
export function normalizeAnswer(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim().replace(/,/g, "");
  if (trimmed.length === 0 || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  return Number(trimmed);
}

/** Masks all but the last 4 characters, e.g. "••••••.org". */
export function maskIdentity(raw: string): string {
  if (raw.length <= 4) {
    return "••••";
  }
  return `${"•".repeat(Math.min(raw.length - 4, 8))}${raw.slice(-4)}`;
}
