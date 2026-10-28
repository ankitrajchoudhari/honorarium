import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { combine } from "@/engine/combine";
import { ruleSetSchema } from "@/engine/dsl";
import { evaluateRuleSet } from "@/engine/rules";
import { findClusters, similarityChecks } from "@/engine/similarity";
import type { Check, Decision } from "@/engine/types";
import { buildRespondents, importMappingSchema, roleColumnsOf, validateMapping } from "@/import/mapping";
import { decodeCsvBytes, parseCsvText } from "@/lib/csv";

/** Runs the real sample files through the rule and similarity layers (no AI) and checks the documented patterns. */
const dir = join(process.cwd(), "data", "sample");
const csv = parseCsvText(decodeCsvBytes(readFileSync(join(dir, "sleep-study-responses.csv"))).text);
const mapping = importMappingSchema.parse(JSON.parse(readFileSync(join(dir, "mapping.json"), "utf8")));
const rules = ruleSetSchema.parse(JSON.parse(readFileSync(join(dir, "rules.json"), "utf8")).ruleSet);
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Record<string, string[]>;

if (!csv.ok) {
  throw new Error(csv.error);
}
const { respondents } = buildRespondents(mapping, csv.csv.columns, csv.csv.rows);
const checks = evaluateRuleSet(rules, respondents, { roleColumns: roleColumnsOf(mapping), dateOrder: mapping.dateOrder });
for (const column of roleColumnsOf(mapping).open_text ?? []) {
  const similar = similarityChecks(column, findClusters(respondents.map((respondent) => ({ ref: respondent.ref, text: respondent.values[column] ?? "" }))));
  for (const [ref, check] of similar) {
    checks.get(ref)?.push(check);
  }
}
const decisionOf = (ref: string): Decision => combine(checks.get(ref) as Check[]).decision;
const decisions = (pattern: string) => (manifest[pattern] ?? []).map(decisionOf);

describe("sample study (rules + similarity layers)", () => {
  it("imports cleanly with the documented mapping", () => {
    expect(validateMapping(mapping, csv.csv.columns, csv.csv.rows).filter((issue) => issue.level === "error")).toEqual([]);
    expect(respondents).toHaveLength(518);
    expect(respondents.every((respondent) => respondent.submittedAt !== null)).toBe(true);
  });

  it("pays every genuine respondent before AI review", () => {
    expect(new Set(decisions("genuine"))).toEqual(new Set(["pay"]));
  });

  it("never excludes the students sharing a campus IP", () => {
    expect(decisions("genuine_shared_campus_ip")).not.toContain("dont_pay");
  });

  it("excludes the whole bot burst", () => {
    expect(new Set(decisions("bot_burst"))).toEqual(new Set(["dont_pay"]));
  });

  it("keeps the earliest Gmail variant and excludes the later ones", () => {
    expect(decisions("duplicate_identity_kept")).toEqual(["pay"]);
    expect(new Set(decisions("duplicate_identity_later"))).toEqual(new Set(["dont_pay"]));
  });

  it("holds prompt-injection answers before any AI review", () => {
    expect(new Set(decisions("prompt_injection"))).toEqual(new Set(["hold"]));
  });

  it("holds templated answers and age contradictions for review", () => {
    expect(new Set(decisions("templated_text"))).toEqual(new Set(["hold"]));
    expect(new Set(decisions("age_dob_contradiction"))).toEqual(new Set(["hold"]));
    expect(decisions("missing_payout_email")).toEqual(["hold"]);
    expect(decisions("invalid_phone")).toEqual(["hold"]);
  });

  it("excludes speeders, failed attention checks and ineligible ages", () => {
    expect(new Set([...decisions("speeder"), ...decisions("failed_attention"), ...decisions("too_old")])).toEqual(new Set(["dont_pay"]));
  });
});
