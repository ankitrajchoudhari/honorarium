import { describe, expect, it } from "vitest";
import { combine, ExcludeGuardError } from "@/engine/combine";
import type { AdvisoryCheck, Check, RuleCheck, SystemCheck } from "@/engine/types";

const rule = (outcome: RuleCheck["outcome"], ruleId = "r1"): RuleCheck => ({
  layer: "deterministic",
  source: "rule",
  ruleId,
  outcome,
  evidence: { summary: `${ruleId} ${outcome}` },
});
const ai = (outcome: AdvisoryCheck["outcome"]): AdvisoryCheck => ({ layer: "ai", source: "advisory", ruleId: "ai:Q3", outcome, evidence: { summary: `ai ${outcome}` } });
const similar = (outcome: AdvisoryCheck["outcome"]): AdvisoryCheck => ({
  layer: "similarity",
  source: "advisory",
  ruleId: "similarity:Q3",
  outcome,
  evidence: { summary: `similar ${outcome}` },
});
const system = (outcome: SystemCheck["outcome"]): SystemCheck => ({
  layer: "deterministic",
  source: "system",
  ruleId: "system:payout_identity",
  outcome,
  evidence: { summary: `system ${outcome}` },
});

describe("combine", () => {
  it("pays when everything passes", () => {
    expect(combine([rule("pass"), ai("pass"), similar("pass"), system("pass")])).toEqual({ decision: "pay", reasons: [] });
  });

  it("notes never change the decision", () => {
    expect(combine([rule("note"), ai("note")]).decision).toBe("pay");
  });

  it("any review holds", () => {
    expect(combine([rule("pass"), ai("review")]).decision).toBe("hold");
    expect(combine([similar("review")]).decision).toBe("hold");
    expect(combine([system("review")]).decision).toBe("hold");
  });

  it("a locked-rule exclude means don't pay and lists every reason", () => {
    const result = combine([rule("exclude", "r1"), rule("exclude", "r2"), ai("review"), rule("pass", "r3")]);
    expect(result.decision).toBe("dont_pay");
    expect(result.reasons.map((reason) => reason.summary)).toEqual(["r1 exclude", "r2 exclude", "ai review"]);
  });

  it("AI and similarity checks can never exclude, even if the type system is bypassed", () => {
    const forgedAi = { ...ai("review"), outcome: "exclude" } as unknown as Check;
    const forgedSimilarity = { ...similar("review"), outcome: "exclude" } as unknown as Check;
    const forgedSystem = { ...system("review"), outcome: "exclude" } as unknown as Check;
    expect(() => combine([forgedAi])).toThrow(ExcludeGuardError);
    expect(() => combine([rule("pass"), forgedSimilarity])).toThrow(ExcludeGuardError);
    expect(() => combine([forgedSystem])).toThrow(ExcludeGuardError);
  });
});
