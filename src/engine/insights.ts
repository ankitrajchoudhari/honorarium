import type { RuleType } from "@/engine/dsl";
import type { Decision } from "@/engine/types";

const RULE_TYPE_LABEL: Record<RuleType, string> = {
  min_duration: "Finished too fast",
  attention_check: "Failed attention check",
  honeypot: "Hidden field filled",
  eligibility: "Not eligible",
  age_dob_consistency: "Age and birth date differ",
  one_payment_per_identity: "Duplicate payout identity",
  duplicate_ip: "Shared IP address",
  submission_burst: "Submission burst",
  required_fields: "Missing required answers",
  open_text_min_length: "Answer too short",
  ip_country_mismatch: "IP country mismatch",
};

/** A short chart label for a check id: locked rules by their type, system checks by what they look at. */
export function checkLabel(ruleId: string, ruleTypes: ReadonlyMap<string, RuleType>): string {
  const type = ruleTypes.get(ruleId);
  if (type) {
    return `${ruleId.toUpperCase()} · ${RULE_TYPE_LABEL[type]}`;
  }
  const [kind, detail = ""] = ruleId.split(":");
  const column = detail.split("_")[0] ?? detail;
  switch (kind) {
    case "similarity":
      return `Near-identical answers (${column})`;
    case "ai":
      return `AI flag on ${column}`;
    case "system":
      return detail === "payout_identity" ? "Unusable payout identity" : detail === "instruction_text" ? "Instructions inside an answer" : detail.replace(/_/g, " ");
    default:
      return ruleId;
  }
}

export interface Bin {
  label: string;
  pay: number;
  hold: number;
  dontPay: number;
}

const STEPS_SECONDS = [60, 300, 900, 3_600, 10_800, 21_600, 43_200, 86_400, 604_800];

/**
 * Groups submissions into at most `maxBins` equal time bins, counted by decision. The bin width is the smallest
 * "round" step that fits the whole span, so a burst of minutes stays visible inside a day-long study.
 */
export function binSubmissions(rows: readonly { at: Date | null; decision: Decision | null }[], maxBins = 48, timeZone = "UTC"): Bin[] {
  const times = rows.filter((row): row is { at: Date; decision: Decision | null } => row.at !== null);
  if (times.length === 0) {
    return [];
  }
  const first = Math.min(...times.map((row) => row.at.getTime()));
  const last = Math.max(...times.map((row) => row.at.getTime()));
  const span = Math.max(1, (last - first) / 1000);
  const step = STEPS_SECONDS.find((seconds) => span / seconds <= maxBins) ?? Math.ceil(span / maxBins);
  const start = Math.floor(first / 1000 / step) * step * 1000;
  const count = Math.floor((last - start) / 1000 / step) + 1;
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(step >= 86_400 ? { day: "numeric", month: "short", hour: undefined, minute: undefined } : {}),
  });
  const bins: Bin[] = Array.from({ length: count }, (_, index) => ({ label: format.format(new Date(start + index * step * 1000)), pay: 0, hold: 0, dontPay: 0 }));
  for (const row of times) {
    const bin = bins[Math.floor((row.at.getTime() - start) / 1000 / step)];
    if (!bin) {
      continue;
    }
    if (row.decision === "pay") {
      bin.pay += 1;
    } else if (row.decision === "hold") {
      bin.hold += 1;
    } else if (row.decision === "dont_pay") {
      bin.dontPay += 1;
    }
  }
  return bins;
}
