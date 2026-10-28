/** All money is integer cents. These helpers only convert at the edges (input and display). */

export function assertCents(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Money must be a whole number of cents, got ${value}.`);
  }
  return value;
}

/** "$1,500.00" for 150000. */
export function formatCents(cents: number, currency = "USD"): string {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${sign}${symbol}${dollars.toLocaleString("en-US")}.${remainder.toString().padStart(2, "0")}`;
}

/** "10.50" (as sent to PayPal) for 1050. */
export function centsToDecimalString(cents: number): string {
  assertCents(cents);
  if (cents < 0) {
    throw new Error("Payout amounts cannot be negative.");
  }
  return `${Math.floor(cents / 100)}.${(cents % 100).toString().padStart(2, "0")}`;
}

/** Parses user input like "1,500" or "10.5" into cents without floating point. Returns null if invalid. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    return null;
  }
  const dollars = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return dollars * 100 + Number(fraction);
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => assertCents(total + assertCents(value)), 0);
}
