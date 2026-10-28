import type { Rule } from "@/engine/dsl";
import { describeRef } from "@/engine/rules";

const OUTCOME_PHRASE: Record<Rule["outcome_on_fail"], string> = {
  exclude: "is not paid",
  review: "is held for human review",
  note: "gets a note (no effect on payment)",
};

function minutes(seconds: number): string {
  if (seconds % 60 === 0) {
    const count = seconds / 60;
    return `${count} minute${count === 1 ? "" : "s"}`;
  }
  return `${seconds} seconds`;
}

/** A plain-English sentence that reads a compiled rule back to the researcher. */
export function readBack(rule: Rule): string {
  const consequence = OUTCOME_PHRASE[rule.outcome_on_fail];
  switch (rule.type) {
    case "min_duration":
      return `A response finished in under ${minutes(rule.params.seconds)} ${consequence}.`;
    case "attention_check": {
      const checks = rule.params.checks.map((check) => `${describeRef(check.field)} must be "${check.expected}"`).join("; ");
      const allowance =
        rule.params.max_failures === 0
          ? "Any failed check"
          : `More than ${rule.params.max_failures} failed check${rule.params.max_failures === 1 ? "" : "s"}`;
      return `Attention check: ${checks}. ${allowance} means the response ${consequence}.`;
    }
    case "honeypot": {
      const field = rule.params.field.by === "role" && rule.params.field.name === "honeypot" ? "the hidden field" : `the hidden field ${describeRef(rule.params.field)}`;
      return `If ${field} is filled in, the response ${consequence}.`;
    }
    case "eligibility": {
      const { allowed_values: allowed, min, max } = rule.params;
      const condition =
        allowed !== undefined
          ? `must be one of: ${allowed.join(", ")}`
          : min !== undefined && max !== undefined
            ? `must be between ${min} and ${max}`
            : min !== undefined
              ? `must be at least ${min}`
              : `must be at most ${max}`;
      return `${capitalize(describeRef(rule.params.field))} ${condition}; otherwise the response ${consequence}.`;
    }
    case "age_dob_consistency":
      return `If the stated age and the age from the date of birth (on the submission date) differ by more than ${rule.params.tolerance_years} year${rule.params.tolerance_years === 1 ? "" : "s"}, the response ${consequence}.`;
    case "one_payment_per_identity":
      return `Only one payment per payout email or phone (Gmail dot and +tag variants count as the same). The earliest valid submission is kept; each later duplicate ${consequence}.`;
    case "duplicate_ip":
      return `When ${rule.params.threshold} or more responses share an IP address, each ${consequence}. Shared IP alone never stops payment.`;
    case "submission_burst":
      return `When more than ${rule.params.max_in_window} responses arrive within ${minutes(rule.params.window_seconds)}, each response in that burst ${consequence}.`;
    case "required_fields":
      return `If any of ${rule.params.fields.map(describeRef).join(", ")} is empty, the response ${consequence}.`;
    case "open_text_min_length":
      return `If ${describeRef(rule.params.field)} has fewer than ${rule.params.min_chars} characters, the response ${consequence}.`;
    case "ip_country_mismatch":
      return `If the country from the IP address differs from the stated country, the response ${consequence}.`;
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
