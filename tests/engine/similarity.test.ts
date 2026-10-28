import { describe, expect, it } from "vitest";
import { combine } from "@/engine/combine";
import { DEFAULT_SIMILARITY, findClusters, normalizeForSimilarity, similarityChecks } from "@/engine/similarity";

const template = "Getting enough sleep is very important for students because it helps with focus, memory and overall wellbeing during exams.";

describe("similarity clustering", () => {
  it("clusters templated answers that differ only in punctuation and small edits", () => {
    const answers = [
      { ref: "R-0001", text: template },
      { ref: "R-0002", text: template.toUpperCase().replace(/,/g, "") },
      { ref: "R-0003", text: template.replace("very important", "really important") },
      { ref: "R-0004", text: `${template} ` },
      { ref: "R-0005", text: "I usually stay up until 2am rereading organic chemistry notes because I panic about mechanisms." },
      { ref: "R-0006", text: "Coffee after 6pm wrecks me. I lie awake replaying the lecture slides in my head." },
    ];
    const clusters = findClusters(answers);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.refs).toEqual(["R-0001", "R-0002", "R-0003", "R-0004"]);
  });

  it("ignores short answers so 'good' and 'no' never cluster", () => {
    const answers = Array.from({ length: 10 }, (_, index) => ({ ref: `R-${index}`, text: "good" }));
    expect(findClusters(answers)).toEqual([]);
  });

  it("needs at least three near-identical answers", () => {
    expect(findClusters([{ ref: "A", text: template }, { ref: "B", text: template }])).toEqual([]);
  });

  it("is deterministic", () => {
    const answers = Array.from({ length: 40 }, (_, index) => ({ ref: `R-${index}`, text: index % 2 === 0 ? `${template} ${index % 3}` : `Unique answer number ${index} about my late night gaming habit and its effects` }));
    expect(findClusters(answers)).toEqual(findClusters(answers));
  });

  it("produces review checks with linked refs, never exclude", () => {
    const answers = ["A", "B", "C", "D", "E"].map((ref) => ({ ref, text: template }));
    const checks = similarityChecks("Q3", findClusters(answers, DEFAULT_SIMILARITY));
    const check = checks.get("A");
    expect(check?.outcome).toBe("review");
    expect(check?.evidence.summary).toBe("Q3: near-identical to B, C and 2 others");
    expect(check?.evidence.linkedRefs).toEqual(["B", "C", "D", "E"]);
    expect(combine(check ? [check] : []).decision).toBe("hold");
  });

  it("normalizes case, punctuation and whitespace", () => {
    expect(normalizeForSimilarity("  Hello,   WORLD!! Café ")).toBe("hello world café");
  });
});
