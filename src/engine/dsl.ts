import { z } from "@/lib/zod";
import { COLUMN_ROLES } from "@/engine/roles";

/** A rule names its data either by mapped role ("the hidden field") or by exact CSV column ("Q14"). */
export const fieldRefSchema = z.object({
  by: z.enum(["role", "column"]),
  name: z.string().trim().min(1).max(200),
});
export type FieldRef = z.infer<typeof fieldRefSchema>;

const outcomeOnFail = z.enum(["exclude", "review", "note"]);
const reviewAtMost = z.enum(["review", "note"]);
const ruleId = z.string().regex(/^r[0-9]{1,3}$/, "Rule ids look like r1, r2, …");

const base = { id: ruleId, outcome_on_fail: outcomeOnFail };

export const ruleSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("min_duration"), params: z.object({ seconds: z.int().positive().max(86_400) }) }),
  z.object({
    ...base,
    type: z.literal("attention_check"),
    params: z
      .object({
        checks: z.array(z.object({ field: fieldRefSchema, expected: z.string().trim().min(1).max(500) })).min(1).max(20),
        max_failures: z.int().min(0).max(19),
      })
      .refine((p) => p.max_failures < p.checks.length, {
        message: "max_failures must be lower than the number of checks, otherwise the rule can never fail. Use 0 when any failed check counts.",
      }),
  }),
  z.object({ ...base, type: z.literal("honeypot"), params: z.object({ field: fieldRefSchema }) }),
  z.object({
    ...base,
    type: z.literal("eligibility"),
    params: z
      .object({
        field: fieldRefSchema,
        allowed_values: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .refine((p) => p.allowed_values !== undefined || p.min !== undefined || p.max !== undefined, {
        message: "An eligibility rule needs allowed values or a numeric range.",
      })
      .refine((p) => p.min === undefined || p.max === undefined || p.min <= p.max, { message: "min must not exceed max." }),
  }),
  z.object({
    ...base,
    type: z.literal("age_dob_consistency"),
    params: z.object({
      age_field: fieldRefSchema,
      dob_field: fieldRefSchema,
      tolerance_years: z.int().min(0).max(10),
    }),
  }),
  z.object({ ...base, type: z.literal("one_payment_per_identity"), params: z.object({ keep: z.literal("earliest") }) }),
  z.object({
    id: ruleId,
    outcome_on_fail: reviewAtMost,
    type: z.literal("duplicate_ip"),
    params: z.object({ threshold: z.int().min(2).max(10_000) }),
  }),
  z.object({
    ...base,
    type: z.literal("submission_burst"),
    params: z.object({ window_seconds: z.int().positive().max(86_400), max_in_window: z.int().positive().max(100_000) }),
  }),
  z.object({
    ...base,
    type: z.literal("required_fields"),
    params: z.object({ fields: z.array(fieldRefSchema).min(1).max(50) }),
  }),
  z.object({
    ...base,
    type: z.literal("open_text_min_length"),
    params: z.object({ field: fieldRefSchema, min_chars: z.int().positive().max(5_000) }),
  }),
  z.object({
    id: ruleId,
    outcome_on_fail: reviewAtMost,
    type: z.literal("ip_country_mismatch"),
    params: z.object({ ip_country_field: fieldRefSchema, country_field: fieldRefSchema }),
  }),
]);

export type Rule = z.infer<typeof ruleSchema>;
export type RuleType = Rule["type"];

export const ruleSetSchema = z
  .object({ rules: z.array(ruleSchema).max(50) })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.rules.forEach((rule, index) => {
      if (seen.has(rule.id)) {
        ctx.addIssue({ code: "custom", path: ["rules", index, "id"], message: `Duplicate rule id ${rule.id}.` });
      }
      seen.add(rule.id);
      for (const ref of fieldRefsOf(rule)) {
        if (ref.by === "role" && !(COLUMN_ROLES as readonly string[]).includes(ref.name)) {
          ctx.addIssue({ code: "custom", path: ["rules", index], message: `Unknown role "${ref.name}".` });
        }
      }
    });
    if (value.rules.filter((rule) => rule.type === "one_payment_per_identity").length > 1) {
      ctx.addIssue({ code: "custom", path: ["rules"], message: "Only one one-payment-per-identity rule is allowed." });
    }
  });

export type RuleSet = z.infer<typeof ruleSetSchema>;

export function fieldRefsOf(rule: Rule): FieldRef[] {
  switch (rule.type) {
    case "attention_check":
      return rule.params.checks.map((check) => check.field);
    case "honeypot":
    case "eligibility":
    case "open_text_min_length":
      return [rule.params.field];
    case "age_dob_consistency":
      return [rule.params.age_field, rule.params.dob_field];
    case "required_fields":
      return rule.params.fields;
    case "ip_country_mismatch":
      return [rule.params.ip_country_field, rule.params.country_field];
    case "min_duration":
    case "one_payment_per_identity":
    case "duplicate_ip":
    case "submission_burst":
      return [];
  }
}

/** Roles a rule set needs mapped before data can be checked (beyond explicit field refs). */
export function impliedRoles(rule: Rule): string[] {
  switch (rule.type) {
    case "min_duration":
      return ["duration_seconds"];
    case "duplicate_ip":
      return ["ip"];
    case "submission_burst":
      return ["submitted_at"];
    default:
      return [];
  }
}
