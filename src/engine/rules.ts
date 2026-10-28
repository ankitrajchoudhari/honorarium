import type { FieldRef, Rule, RuleSet } from "@/engine/dsl";
import { fieldRefsOf, impliedRoles } from "@/engine/dsl";
import { normalizeAnswer, parseNumber } from "@/engine/normalize";
import type { ColumnRole } from "@/engine/roles";
import { ROLE_LABELS } from "@/engine/roles";
import { ageOn, calendarDateUtc, parseCalendarDate, type DateOrder } from "@/engine/time";
import type { Check, EngineRespondent, Evidence, Outcome, RoleColumns, RuleCheck, SystemCheck } from "@/engine/types";

export interface EvaluationContext {
  roleColumns: RoleColumns;
  dateOrder: DateOrder;
}

export interface MissingField {
  ruleId: string;
  label: string;
}

/** Every column or role the rules need, checked against what the import mapped. */
export function missingFields(ruleSet: RuleSet, columns: readonly string[], roleColumns: RoleColumns): MissingField[] {
  const missing: MissingField[] = [];
  for (const rule of ruleSet.rules) {
    for (const ref of fieldRefsOf(rule)) {
      if (resolveColumns(ref, columns, roleColumns).length === 0) {
        missing.push({ ruleId: rule.id, label: describeRef(ref) });
      }
    }
    for (const role of impliedRoles(rule)) {
      if ((roleColumns[role as ColumnRole] ?? []).length === 0) {
        missing.push({ ruleId: rule.id, label: ROLE_LABELS[role as ColumnRole] });
      }
    }
  }
  return missing;
}

export function describeRef(ref: FieldRef): string {
  return ref.by === "role" ? (ROLE_LABELS[ref.name as ColumnRole] ?? ref.name) : `column "${ref.name}"`;
}

function resolveColumns(ref: FieldRef, columns: readonly string[], roleColumns: RoleColumns): string[] {
  if (ref.by === "role") {
    return roleColumns[ref.name as ColumnRole] ?? [];
  }
  const exact = columns.find((column) => column === ref.name);
  if (exact !== undefined) {
    return [exact];
  }
  const wanted = ref.name.trim().toLowerCase();
  const loose = columns.find((column) => column.trim().toLowerCase() === wanted);
  if (loose !== undefined) {
    return [loose];
  }
  // "Q14" in a rule matches a single export column such as "Q14_Attention"; ambiguous prefixes match nothing.
  const prefixed = columns.filter((column) => {
    const lower = column.trim().toLowerCase();
    return lower.startsWith(wanted) && /^[\s_.:-]/.test(lower.slice(wanted.length));
  });
  return prefixed.length === 1 ? prefixed : [];
}

function valueOf(respondent: EngineRespondent, ref: FieldRef, roleColumns: RoleColumns): { column: string; value: string } {
  const columns = resolveColumns(ref, Object.keys(respondent.values), roleColumns);
  const column = columns[0] ?? ref.name;
  return { column, value: respondent.values[column] ?? "" };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

function truncate(text: string, length = 60): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function ruleCheck(rule: Rule, failed: boolean, evidence: Evidence): RuleCheck {
  const outcome: Outcome = failed ? rule.outcome_on_fail : "pass";
  return { layer: "deterministic", source: "rule", ruleId: rule.id, outcome, evidence };
}

/** Earliest submission first; rows without a time sort last, then by row number. */
export function bySubmission(a: EngineRespondent, b: EngineRespondent): number {
  const at = a.submittedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bt = b.submittedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return at === bt ? a.rowNumber - b.rowNumber : at - bt;
}

function evaluateRow(rule: Rule, respondent: EngineRespondent, context: EvaluationContext): RuleCheck | null {
  const { roleColumns } = context;
  switch (rule.type) {
    case "min_duration": {
      const duration = respondent.durationSeconds;
      if (duration === null) {
        return { layer: "deterministic", source: "rule", ruleId: rule.id, outcome: "review", evidence: { summary: "Duration missing · rule needs it" } };
      }
      return ruleCheck(rule, duration < rule.params.seconds, {
        summary: `Finished in ${formatDuration(duration)} · min ${formatDuration(rule.params.seconds)}`,
        values: { duration_seconds: duration, minimum_seconds: rule.params.seconds },
      });
    }
    case "attention_check": {
      const failures = rule.params.checks
        .map((check) => ({ ...valueOf(respondent, check.field, roleColumns), expected: check.expected }))
        .filter((entry) => normalizeAnswer(entry.value) !== normalizeAnswer(entry.expected));
      const failed = failures.length > rule.params.max_failures;
      const first = failures[0];
      return ruleCheck(rule, failed, {
        summary: first
          ? `${first.column}: "${truncate(first.value || "no answer", 30)}" · expected "${truncate(first.expected, 30)}"`
          : `Attention check passed`,
        values: { failures: failures.length, allowed_failures: rule.params.max_failures },
      });
    }
    case "honeypot": {
      const { column, value } = valueOf(respondent, rule.params.field, roleColumns);
      const filled = value.trim().length > 0;
      return ruleCheck(rule, filled, {
        summary: filled ? `Hidden field ${column} was filled` : "Hidden field empty",
        quote: filled ? truncate(value, 120) : undefined,
      });
    }
    case "eligibility": {
      const { column, value } = valueOf(respondent, rule.params.field, roleColumns);
      const { allowed_values: allowed, min, max } = rule.params;
      if (value.trim().length === 0) {
        return ruleCheck(rule, true, { summary: `${column}: no answer` });
      }
      if (allowed !== undefined && !allowed.map(normalizeAnswer).includes(normalizeAnswer(value))) {
        return ruleCheck(rule, true, { summary: `${column}: "${truncate(value, 30)}" not eligible`, values: { answer: value } });
      }
      if (min !== undefined || max !== undefined) {
        const number = parseNumber(value);
        if (number === null) {
          return ruleCheck(rule, true, { summary: `${column}: "${truncate(value, 30)}" is not a number` });
        }
        const outside = (min !== undefined && number < min) || (max !== undefined && number > max);
        const range = min !== undefined && max !== undefined ? `${min}–${max}` : min !== undefined ? `≥ ${min}` : `≤ ${max}`;
        return ruleCheck(rule, outside, { summary: `${column} ${number} · allowed ${range}`, values: { answer: number } });
      }
      return ruleCheck(rule, false, { summary: `${column}: eligible` });
    }
    case "age_dob_consistency": {
      const age = parseNumber(valueOf(respondent, rule.params.age_field, roleColumns).value);
      const dobRaw = valueOf(respondent, rule.params.dob_field, roleColumns).value;
      const dob = parseCalendarDate(dobRaw, context.dateOrder);
      if (age === null || dob === null || respondent.submittedAt === null) {
        return {
          layer: "deterministic",
          source: "rule",
          ruleId: rule.id,
          outcome: "review",
          evidence: { summary: "Could not compare age and date of birth", values: { age: age, date_of_birth: dobRaw } },
        };
      }
      const computed = ageOn(dob, calendarDateUtc(respondent.submittedAt));
      const gap = Math.abs(computed - age);
      return ruleCheck(rule, gap > rule.params.tolerance_years, {
        summary: `Age ${age} · birth date gives ${computed}`,
        values: { stated_age: age, age_from_birth_date: computed, tolerance_years: rule.params.tolerance_years },
      });
    }
    case "required_fields": {
      const empty = rule.params.fields
        .map((ref) => valueOf(respondent, ref, roleColumns))
        .filter((entry) => entry.value.trim().length === 0)
        .map((entry) => entry.column);
      return ruleCheck(rule, empty.length > 0, {
        summary: empty.length > 0 ? `Missing ${empty.slice(0, 3).join(", ")}${empty.length > 3 ? ` and ${empty.length - 3} more` : ""}` : "Required fields present",
      });
    }
    case "open_text_min_length": {
      const { column, value } = valueOf(respondent, rule.params.field, roleColumns);
      const length = value.trim().length;
      return ruleCheck(rule, length < rule.params.min_chars, {
        summary: `${column}: ${length} characters · min ${rule.params.min_chars}`,
        values: { characters: length },
      });
    }
    case "ip_country_mismatch": {
      const ipCountry = valueOf(respondent, rule.params.ip_country_field, roleColumns).value;
      const country = valueOf(respondent, rule.params.country_field, roleColumns).value;
      if (ipCountry.trim().length === 0 || country.trim().length === 0) {
        return ruleCheck(rule, false, { summary: "Country not available" });
      }
      const differs = normalizeAnswer(ipCountry) !== normalizeAnswer(country);
      return ruleCheck(rule, differs, { summary: `IP country ${ipCountry} · stated ${country}` });
    }
    case "one_payment_per_identity":
    case "duplicate_ip":
    case "submission_burst":
      return null;
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    if (value === null) {
      continue;
    }
    const list = groups.get(value);
    if (list) {
      list.push(item);
    } else {
      groups.set(value, [item]);
    }
  }
  return groups;
}

function linkedSummary(prefix: string, refs: string[]): string {
  const shown = refs.slice(0, 2).join(", ");
  return refs.length > 2 ? `${prefix} ${shown} and ${refs.length - 2} others` : `${prefix} ${shown}`;
}

function evaluateDuplicateIp(rule: Extract<Rule, { type: "duplicate_ip" }>, respondents: EngineRespondent[], context: EvaluationContext, out: Map<string, Check[]>) {
  const ipColumn = context.roleColumns.ip?.[0];
  const groups = groupBy(respondents, (respondent) => {
    const ip = ipColumn ? respondent.values[ipColumn]?.trim() : undefined;
    return ip ? ip : null;
  });
  for (const respondent of respondents) {
    const ip = ipColumn ? respondent.values[ipColumn]?.trim() : undefined;
    const group = ip ? (groups.get(ip) ?? []) : [];
    const shared = group.length >= rule.params.threshold;
    const others = group.filter((member) => member.ref !== respondent.ref).map((member) => member.ref);
    out.get(respondent.ref)?.push(
      ruleCheck(rule, shared, {
        summary: shared ? `Same IP as ${others.length} other responses` : "IP not shared above threshold",
        linkedRefs: shared ? others : undefined,
        values: { submissions_from_ip: group.length, threshold: rule.params.threshold },
      }),
    );
  }
}

function evaluateBurst(rule: Extract<Rule, { type: "submission_burst" }>, respondents: EngineRespondent[], out: Map<string, Check[]>) {
  const timed = respondents.filter((respondent) => respondent.submittedAt !== null).sort(bySubmission);
  const windowMs = rule.params.window_seconds * 1000;
  const flagged = new Map<string, number>();
  let start = 0;
  for (let end = 0; end < timed.length; end += 1) {
    const endTime = timed[end]!.submittedAt!.getTime();
    while (endTime - timed[start]!.submittedAt!.getTime() > windowMs) {
      start += 1;
    }
    const count = end - start + 1;
    if (count > rule.params.max_in_window) {
      for (let index = start; index <= end; index += 1) {
        const ref = timed[index]!.ref;
        flagged.set(ref, Math.max(flagged.get(ref) ?? 0, count));
      }
    }
  }
  for (const respondent of respondents) {
    const count = flagged.get(respondent.ref);
    out.get(respondent.ref)?.push(
      ruleCheck(rule, count !== undefined, {
        summary:
          count !== undefined
            ? `${count} submissions within ${formatDuration(rule.params.window_seconds)} · max ${rule.params.max_in_window}`
            : respondent.submittedAt === null
              ? "No submission time"
              : "Not part of a burst",
        values: count !== undefined ? { submissions_in_window: count, window_seconds: rule.params.window_seconds } : undefined,
      }),
    );
  }
}

function excludedByOtherRules(checks: Check[]): boolean {
  return checks.some((check) => check.source === "rule" && check.outcome === "exclude");
}

function evaluateIdentities(rule: Extract<Rule, { type: "one_payment_per_identity" }> | null, respondents: EngineRespondent[], out: Map<string, Check[]>) {
  const groups = groupBy(respondents, (respondent) => respondent.payout?.normalized ?? null);
  for (const respondent of respondents) {
    const normalized = respondent.payout?.normalized;
    const group = normalized ? (groups.get(normalized) ?? []) : [];
    const checks = out.get(respondent.ref) ?? [];
    if (group.length < 2) {
      if (rule) {
        checks.push(ruleCheck(rule, false, { summary: "Only payment to this identity" }));
      }
      continue;
    }
    const ordered = [...group].sort(bySubmission);
    const eligible = ordered.filter((member) => !excludedByOtherRules(out.get(member.ref) ?? []));
    const keeper = eligible[0] ?? ordered[0]!;
    const others = ordered.filter((member) => member.ref !== respondent.ref).map((member) => member.ref);
    const label = respondent.payout?.type === "phone" ? "phone" : "email";
    if (respondent.ref === keeper.ref) {
      const evidence: Evidence = { summary: linkedSummary(`Earliest of ${group.length} with same ${label} ·`, others), linkedRefs: others };
      checks.push(rule ? ruleCheck(rule, false, evidence) : systemCheck("system:duplicate_identity", "note", evidence));
    } else {
      const evidence: Evidence = { summary: `Same payout ${label} as ${keeper.ref}`, linkedRefs: others, values: { kept: keeper.ref } };
      checks.push(rule ? ruleCheck(rule, true, evidence) : systemCheck("system:duplicate_identity", "review", evidence));
    }
  }
}

function systemCheck(ruleId: SystemCheck["ruleId"], outcome: SystemCheck["outcome"], evidence: Evidence): SystemCheck {
  return { layer: "deterministic", source: "system", ruleId, outcome, evidence };
}

function payoutCheck(respondent: EngineRespondent): SystemCheck {
  const payout = respondent.payout;
  if (payout === null) {
    return systemCheck("system:payout_identity", "review", { summary: "No payout email or phone" });
  }
  if (payout.normalized === null) {
    return systemCheck("system:payout_identity", "review", {
      summary: payout.type === "phone" ? "Phone number not valid for payout" : "Email not valid for payout",
    });
  }
  return systemCheck("system:payout_identity", "pass", { summary: `Payout ${payout.type} present` });
}

/** Phrases that address an automated reviewer rather than answer the survey (prompt-injection attempts). */
const INSTRUCTION_PATTERNS = [
  /\bignore (all |any )?(previous|prior|above|earlier) (instructions|rules|prompts?)\b/i,
  /\b(system|assistant|developer)\s*(note|prompt|message)?\s*:/i,
  /<\/?(answer|system|instructions?|prompt)>/i,
  /\b(approve|authori[sz]e) (the )?payment\b/i,
  /\b(mark|classify|label) (this|me|my) (response|answer)? ?as (genuine|valid|legit)/i,
  /\bset (the )?decision to\b/i,
  /\bskip (all )?(the )?checks\b/i,
];

export function instructionLikeText(text: string): string | null {
  for (const pattern of INSTRUCTION_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return match[0];
    }
  }
  return null;
}

function instructionChecks(respondents: EngineRespondent[], context: EvaluationContext, out: Map<string, Check[]>) {
  const columns = context.roleColumns.open_text ?? [];
  for (const respondent of respondents) {
    for (const column of columns) {
      const text = respondent.values[column] ?? "";
      const match = instructionLikeText(text);
      if (match) {
        out.get(respondent.ref)?.push(systemCheck("system:instruction_text", "review", { summary: `${column}: text addressed to an automated reviewer`, quote: match, values: { column } }));
        break;
      }
    }
  }
}

/**
 * Runs the locked rule set and the built-in payout checks over all respondents.
 * Cross-row rules (duplicates, IP, bursts) need the whole study, so this always takes every row.
 */
export function evaluateRuleSet(ruleSet: RuleSet, respondents: EngineRespondent[], context: EvaluationContext): Map<string, Check[]> {
  const out = new Map<string, Check[]>(respondents.map((respondent) => [respondent.ref, [payoutCheck(respondent)]]));
  for (const rule of ruleSet.rules) {
    if (rule.type === "duplicate_ip") {
      evaluateDuplicateIp(rule, respondents, context, out);
    } else if (rule.type === "submission_burst") {
      evaluateBurst(rule, respondents, out);
    } else if (rule.type !== "one_payment_per_identity") {
      for (const respondent of respondents) {
        const check = evaluateRow(rule, respondent, context);
        if (check) {
          out.get(respondent.ref)?.push(check);
        }
      }
    }
  }
  const identityRule = ruleSet.rules.find((rule): rule is Extract<Rule, { type: "one_payment_per_identity" }> => rule.type === "one_payment_per_identity") ?? null;
  evaluateIdentities(identityRule, respondents, out);
  instructionChecks(respondents, context, out);
  return out;
}
